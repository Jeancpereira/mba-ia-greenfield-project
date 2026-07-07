import { existsSync } from 'fs';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { FfmpegService } from './ffmpeg.service';

const FIXTURE = join(__dirname, '../../../test/fixtures/sample.mp4');

// Runs the real ffprobe/ffmpeg binaries shipped in the container image.
describe('FfmpegService (integration)', () => {
  const service = new FfmpegService();
  let workDir: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'ffmpeg-spec-'));
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('should probe duration and stream metadata from a real video', async () => {
    const result = await service.probe(FIXTURE);

    expect(result.durationSeconds).toBe(2);
    expect(result.metadata.codec).toBe('h264');
    expect(result.metadata.width).toBe(320);
    expect(result.metadata.height).toBe(240);
  });

  it('should capture a JPEG thumbnail frame', async () => {
    const outputPath = join(workDir, 'thumb.jpg');

    await service.captureThumbnail(FIXTURE, outputPath);

    expect(existsSync(outputPath)).toBe(true);
    const jpeg = await readFile(outputPath);
    // JPEG magic bytes
    expect(jpeg[0]).toBe(0xff);
    expect(jpeg[1]).toBe(0xd8);
  });

  it('should reject a file that is not a video', async () => {
    const notVideo = join(workDir, 'not-a-video.mp4');
    await writeFile(notVideo, 'plain text pretending to be video');

    await expect(service.probe(notVideo)).rejects.toThrow();
  });
});
