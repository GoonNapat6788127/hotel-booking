import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@ApiResponse({ status: 429, description: 'Too Many Requests' })
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiOperation({ summary: 'API root', description: 'Public. Returns a hello message when the API is up.' })
  @ApiResponse({ status: 200, description: 'API is running', schema: { type: 'string', example: 'Hello World!' } })
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @ApiOperation({ summary: 'Health check', description: 'Public. Returns 200 while the API process is running. Use it for Docker healthchecks and server monitoring.' })
  @ApiResponse({ status: 200, description: 'Service is healthy', schema: { example: { status: 'ok', uptime: 123.4, timestamp: '2026-11-09T08:30:00.000Z' } } })
  @Get('health')
  health() {
    return { status: 'ok', uptime: Math.round(process.uptime() * 10) / 10, timestamp: new Date().toISOString() };
  }
}