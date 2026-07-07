import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { StorageModule } from '../storage/storage.module';
import { Video } from './entities/video.entity';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';
import { VIDEO_QUEUE } from './video-queue.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video, Channel]),
    BullModule.registerQueue({ name: VIDEO_QUEUE }),
    StorageModule,
  ],
  controllers: [VideosController],
  providers: [VideosService],
  exports: [VideosService],
})
export class VideosModule {}
