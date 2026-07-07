import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from '../config/database.config';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import { envValidationSchema } from '../config/env.validation';
import { Channel } from '../channels/entities/channel.entity';
import { User } from '../users/entities/user.entity';
import { StorageModule } from '../storage/storage.module';
import { Video } from '../videos/entities/video.entity';
import { FfmpegService } from '../videos/processing/ffmpeg.service';
import { VideoProcessingProcessor } from '../videos/processing/video-processing.processor';

/**
 * Standalone worker application context (TD-03). Registers the BullMQ
 * processor — which therefore never runs inside the API process — plus the
 * infrastructure it needs. No controllers.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, queueConfig, storageConfig],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [queueConfig.KEY],
      useFactory: (queue: ConfigType<typeof queueConfig>) => ({
        connection: {
          host: queue.redisHost,
          port: queue.redisPort,
        },
      }),
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [databaseConfig.KEY],
      useFactory: (dbConfig: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres',
        host: dbConfig.host,
        port: dbConfig.port,
        username: dbConfig.username,
        password: dbConfig.password,
        database: dbConfig.name,
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    TypeOrmModule.forFeature([Video, Channel, User]),
    StorageModule,
  ],
  providers: [FfmpegService, VideoProcessingProcessor],
})
export class WorkerModule {}
