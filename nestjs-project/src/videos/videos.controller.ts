import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { CreateVideoDto } from './dto/create-video.dto';
import { PartUrlsDto } from './dto/part-urls.dto';
import type { Video } from './entities/video.entity';
import { VideosService } from './videos.service';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Initiate a video upload',
    description:
      'Pre-registers the video as a draft on the authenticated user’s channel and opens a multipart upload session. The file goes directly to object storage via presigned part URLs — never through this API.',
  })
  @ApiResponse({
    status: 201,
    description: 'Draft created; multipart upload session opened',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        slug: { type: 'string' },
        status: { type: 'string', enum: ['draft'] },
        upload: {
          type: 'object',
          properties: {
            upload_id: { type: 'string' },
            part_size: { type: 'number' },
            part_count: { type: 'number' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed (size > 10GB, non-video mime type, ...)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVideoDto,
  ): Promise<{
    id: string;
    slug: string;
    status: string;
    upload: { upload_id: string; part_size: number; part_count: number };
  }> {
    const { video, partSize, partCount } =
      await this.videosService.initiateUpload(user.sub, dto);
    return {
      id: video.id,
      slug: video.slug,
      status: video.status,
      upload: {
        upload_id: video.upload_id!,
        part_size: partSize,
        part_count: partCount,
      },
    };
  }

  @Post(':slug/upload/part-urls')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Presign upload part URLs',
    description:
      'Returns presigned PUT URLs for the requested part numbers, signed against the public storage endpoint. The client must retain each response ETag for completion.',
  })
  @ApiResponse({ status: 200, description: 'Presigned URLs generated' })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  @ApiResponse({
    status: 403,
    description: 'Authenticated user does not own the video',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Unknown slug',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not draft / no open upload session',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async partUrls(
    @CurrentUser() user: JwtPayload,
    @Param('slug') slug: string,
    @Body() dto: PartUrlsDto,
  ): Promise<{
    urls: { part_number: number; url: string; expires_in: number }[];
  }> {
    const parts = await this.videosService.getPartUrls(
      user.sub,
      slug,
      dto.part_numbers,
    );
    return {
      urls: parts.map((part) => ({
        part_number: part.partNumber,
        url: part.url,
        expires_in: part.expiresIn,
      })),
    };
  }

  @Post(':slug/upload/complete')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Complete the upload',
    description:
      'Completes the multipart upload on the storage, flips the video to `processing` and enqueues the background processing job (metadata extraction + thumbnail).',
  })
  @ApiResponse({
    status: 202,
    description: 'Upload completed; processing enqueued',
  })
  @ApiResponse({
    status: 400,
    description: 'Storage rejected the part list (UPLOAD_INCOMPLETE)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  @ApiResponse({
    status: 403,
    description: 'Authenticated user does not own the video',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Unknown slug',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not draft / no open upload session',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async complete(
    @CurrentUser() user: JwtPayload,
    @Param('slug') slug: string,
    @Body() dto: CompleteUploadDto,
  ): Promise<{ id: string; slug: string; status: string }> {
    const video = await this.videosService.completeUpload(user.sub, slug, dto);
    return { id: video.id, slug: video.slug, status: video.status };
  }

  @Public()
  @Get(':slug')
  @ApiOperation({
    summary: 'Video details',
    description:
      'Anonymous callers only see `ready` videos; the owner (valid Bearer token) sees any status, including `error_reason` on failures.',
  })
  @ApiResponse({ status: 200, description: 'Video details' })
  @ApiResponse({
    status: 404,
    description: 'Unknown slug, or video not ready and caller is not the owner',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async details(
    @Param('slug') slug: string,
    @CurrentUser() user?: JwtPayload,
  ): Promise<Record<string, unknown>> {
    const video = await this.videosService.findBySlug(slug, user?.sub);
    const isOwner = user !== undefined && video.channel.user_id === user.sub;
    const thumbnailUrl = await this.videosService.getThumbnailUrl(video);
    return this.toDetails(video, thumbnailUrl, isOwner);
  }

  @Public()
  @Get(':slug/stream')
  @ApiOperation({
    summary: 'Stream the video',
    description:
      'Redirects (302) to a short-lived presigned URL on the object storage, which serves HTTP Range requests (206 Partial Content) natively — playback starts without downloading the whole file.',
  })
  @ApiResponse({ status: 302, description: 'Redirect to presigned URL' })
  @ApiResponse({
    status: 404,
    description: 'Unknown slug or video not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async stream(
    @Param('slug') slug: string,
    @Res() response: Response,
    @CurrentUser() user?: JwtPayload,
  ): Promise<void> {
    const url = await this.videosService.getStreamUrl(slug, user?.sub);
    response.redirect(HttpStatus.FOUND, url);
  }

  @Public()
  @Get(':slug/download')
  @ApiOperation({
    summary: 'Download the video',
    description:
      'Redirects (302) to a presigned URL with `Content-Disposition: attachment`.',
  })
  @ApiResponse({ status: 302, description: 'Redirect to presigned URL' })
  @ApiResponse({
    status: 404,
    description: 'Unknown slug or video not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async download(
    @Param('slug') slug: string,
    @Res() response: Response,
    @CurrentUser() user?: JwtPayload,
  ): Promise<void> {
    const url = await this.videosService.getDownloadUrl(slug, user?.sub);
    response.redirect(HttpStatus.FOUND, url);
  }

  private toDetails(
    video: Video,
    thumbnailUrl: string | null,
    isOwner: boolean,
  ): Record<string, unknown> {
    return {
      id: video.id,
      slug: video.slug,
      title: video.title,
      status: video.status,
      duration_seconds: video.duration_seconds,
      metadata: video.metadata,
      thumbnail_url: thumbnailUrl,
      ...(isOwner && { error_reason: video.error_reason }),
      created_at: video.created_at,
    };
  }
}
