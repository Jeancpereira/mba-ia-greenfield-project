import * as http from 'http';

export interface PresignedResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

/**
 * Fetches a presigned URL from inside the Compose network.
 *
 * Presigned URLs are signed against the PUBLIC storage endpoint
 * (S3_PUBLIC_ENDPOINT, e.g. http://localhost:9000) so they work for clients
 * outside Docker. Inside a container, `localhost:9000` is not MinIO — so this
 * helper connects to the internal `minio:9000` while preserving the original
 * `Host` header, which is what the signature covers.
 */
export function fetchPresigned(
  url: string,
  options: {
    method?: string;
    body?: Buffer;
    headers?: Record<string, string>;
    connectHost?: string;
    connectPort?: number;
  } = {},
): Promise<PresignedResponse> {
  const parsed = new URL(url);
  const {
    method = 'GET',
    body,
    headers = {},
    connectHost = 'minio',
    connectPort = 9000,
  } = options;

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: connectHost,
        port: connectPort,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: {
          Host: parsed.host,
          ...(body && { 'Content-Length': body.length }),
          ...headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    request.on('error', reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });
}
