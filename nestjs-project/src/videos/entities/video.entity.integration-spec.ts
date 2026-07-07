import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Video, VideoStatus } from './video.entity';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  let counter = 0;
  async function createChannel(): Promise<Channel> {
    const user = await userRepository.save(
      userRepository.create({
        email: `video_user_${++counter}@example.com`,
        password: 'hashed',
      }),
    );
    return channelRepository.save(
      channelRepository.create({
        name: `Channel ${counter}`,
        nickname: `video_chan_${counter}`,
        user_id: user.id,
      }),
    );
  }

  function buildVideo(channel: Channel, overrides: Partial<Video> = {}) {
    return videoRepository.create({
      channel_id: channel.id,
      title: 'My video',
      slug: `slug_${++counter}`.padEnd(11, 'x'),
      original_key: `videos/x/original.mp4`,
      mime_type: 'video/mp4',
      file_size: '1024',
      ...overrides,
    });
  }

  it('should default status to draft', async () => {
    const channel = await createChannel();
    const video = await videoRepository.save(buildVideo(channel));

    const found = await videoRepository.findOneByOrFail({ id: video.id });
    expect(found.status).toBe(VideoStatus.DRAFT);
  });

  it('should enforce unique slug constraint', async () => {
    const channel = await createChannel();
    const slug = 'unique_slug';

    await videoRepository.save(buildVideo(channel, { slug }));

    await expect(
      videoRepository.save(buildVideo(channel, { slug })),
    ).rejects.toThrow();
  });

  it('should enforce the channel foreign key', async () => {
    const channel = await createChannel();
    const orphan = buildVideo(channel, {
      channel_id: '00000000-0000-0000-0000-000000000000',
    });

    await expect(videoRepository.save(orphan)).rejects.toThrow();
  });

  it('should persist nullable processing fields as null by default', async () => {
    const channel = await createChannel();
    const video = await videoRepository.save(buildVideo(channel));

    const found = await videoRepository.findOneByOrFail({ id: video.id });
    expect(found.thumbnail_key).toBeNull();
    expect(found.duration_seconds).toBeNull();
    expect(found.metadata).toBeNull();
    expect(found.error_reason).toBeNull();
  });

  it('should load the channel relation', async () => {
    const channel = await createChannel();
    const video = await videoRepository.save(buildVideo(channel));

    const found = await videoRepository.findOneOrFail({
      where: { id: video.id },
      relations: { channel: true },
    });
    expect(found.channel.id).toBe(channel.id);
  });
});
