import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from './prisma/prisma.service';

@ApiTags('health')
@ApiResponse({ status: 429, description: 'Too Many Requests' })
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) { }

  @ApiOperation({ summary: 'API root', description: 'Public. Returns a hello message when the API is up.' })
  @ApiResponse({ status: 200, description: 'API is running', schema: { type: 'string', example: 'Hello World!' } })
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @ApiOperation({
    summary: 'Health check',
    description:
      'Public. Returns 200 when the API process is running and the database answers, 503 when the database is unreachable. Use it for Docker/Railway healthchecks and uptime monitoring.',
  })
  @ApiResponse({
    status: 200,
    description: 'Service is healthy',
    schema: { example: { status: 'ok', database: 'up', uptime: 123.4, timestamp: '2026-11-09T08:30:00.000Z' } },
  })
  @ApiResponse({
    status: 503,
    description: 'Database unreachable',
    schema: { example: { status: 'error', database: 'down', uptime: 123.4, timestamp: '2026-11-09T08:30:00.000Z' } },
  })
  @Get('health')
  async health() {
    const uptime = Math.round(process.uptime() * 10) / 10;
    const timestamp = new Date().toISOString();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up', uptime, timestamp };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'down', uptime, timestamp });
    }
  }
}