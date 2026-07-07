import { execFile } from 'child_process';
import { promisify } from 'util';
import { Injectable } from '@nestjs/common';

const execFileAsync = promisify(execFile);

export interface VideoProbeResult {
  durationSeconds: number;
  metadata: {
    codec: string | null;
    width: number | null;
    height: number | null;
    bitrate: number | null;
    format: string | null;
  };
}

interface FfprobeOutput {
  format?: { duration?: string; bit_rate?: string; format_name?: string };
  streams?: {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
  }[];
}

@Injectable()
export class FfmpegService {
  /** Extracts duration and stream metadata via `ffprobe -print_format json`. */
  async probe(filePath: string): Promise<VideoProbeResult> {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);

    const parsed = JSON.parse(stdout) as FfprobeOutput;
    const videoStream = parsed.streams?.find(
      (stream) => stream.codec_type === 'video',
    );
    if (!videoStream || !parsed.format?.duration) {
      throw new Error(`File is not a processable video: ${filePath}`);
    }

    return {
      durationSeconds: Math.round(parseFloat(parsed.format.duration)),
      metadata: {
        codec: videoStream.codec_name ?? null,
        width: videoStream.width ?? null,
        height: videoStream.height ?? null,
        bitrate: parsed.format.bit_rate
          ? parseInt(parsed.format.bit_rate, 10)
          : null,
        format: parsed.format.format_name ?? null,
      },
    };
  }

  /** Captures a single frame as JPEG thumbnail (~1s in, clamped to start). */
  async captureThumbnail(filePath: string, outputPath: string): Promise<void> {
    await execFileAsync('ffmpeg', [
      '-y',
      '-ss',
      '1',
      '-i',
      filePath,
      '-frames:v',
      '1',
      '-q:v',
      '4',
      outputPath,
    ]);
  }
}
