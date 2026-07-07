import {
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MAX_FILE_SIZE_BYTES } from '../video-queue.constants';

export class CreateVideoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(/\.[A-Za-z0-9]+$/, {
    message: 'file_name must contain an extension',
  })
  file_name: string;

  @IsInt()
  @Min(1)
  @Max(MAX_FILE_SIZE_BYTES)
  file_size: number;

  @IsString()
  @Matches(/^video\//, { message: 'mime_type must be a video/* type' })
  mime_type: string;
}
