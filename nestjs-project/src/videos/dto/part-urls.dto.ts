import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  Min,
} from 'class-validator';
import { MAX_PART_URLS_PER_REQUEST } from '../video-queue.constants';

export class PartUrlsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PART_URLS_PER_REQUEST)
  @IsInt({ each: true })
  @Min(1, { each: true })
  part_numbers: number[];
}
