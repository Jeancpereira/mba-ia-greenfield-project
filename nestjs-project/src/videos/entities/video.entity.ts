import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';

export enum VideoStatus {
  DRAFT = 'draft',
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed',
}

@Entity('videos')
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  channel_id!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'varchar', length: 21, unique: true })
  slug!: string;

  @Index()
  @Column({
    type: 'enum',
    enum: VideoStatus,
    enumName: 'videos_status_enum',
    default: VideoStatus.DRAFT,
  })
  status!: VideoStatus;

  @Column({ type: 'varchar', length: 512 })
  original_key!: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  thumbnail_key!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  upload_id!: string | null;

  @Column({ type: 'varchar', length: 255 })
  mime_type!: string;

  @Column({ type: 'bigint' })
  file_size!: string;

  @Column({ type: 'int', nullable: true })
  duration_seconds!: number | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  error_reason!: string | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  @ManyToOne(() => Channel)
  @JoinColumn({ name: 'channel_id' })
  channel!: Channel;
}
