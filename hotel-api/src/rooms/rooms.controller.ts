import {
  Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, ParseIntPipe,
  UseInterceptors, BadRequestException, UploadedFile, Query, Inject,
  Injectable, ExecutionContext,
} from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { user_role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { diskStorage } from 'multer';
import { SearchRoomsDto } from './dto/search-room.dto';
import { CacheInterceptor, CacheTTL, CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { invalidateKeys } from '../redis-invalidate';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

// Swagger example payload
const roomExample = {
  id: 1, name: 'Deluxe Sea View', capacity: 2, pricePerNight: '2500',
  imageUrl: '/uploads/rooms/3f2b8c1e.jpg', isActive: true, createdAt: '2026-11-01T10:00:00.000Z',
};

// Cache key includes the user's role, so admin and user responses never mix
@Injectable()
class RoleCacheInterceptor extends CacheInterceptor {
  protected trackBy(context: ExecutionContext): string | undefined {
    const req = context.switchToHttp().getRequest();
    if (req.method !== 'GET') return undefined; // only cache reads
    const role = req.user?.role ?? 'anon';
    return `rooms:${role}:${req.originalUrl}`;
  }
}

const roomImageInterceptor = FileInterceptor('file', {
  storage: diskStorage({
    destination: './uploads/rooms',
    filename: (req, file, cb) =>
      cb(null, `${randomUUID()}${extname(file.originalname)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) {
      return cb(new BadRequestException('Only JPG, PNG or WEBP images are allowed'), false);
    }
    cb(null, true);
  },
});

@ApiTags('rooms')
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Unauthorized - missing, invalid or revoked token' })
@ApiResponse({ status: 429, description: 'Too Many Requests' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('rooms')
export class RoomsController {
  constructor(
    private readonly roomsService: RoomsService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) { }

  // Remove every cached rooms response (all roles, all URLs) 
  private async invalidateRooms() {
    await invalidateKeys('rooms:*');
  }

  @ApiOperation({ summary: 'List rooms', description: 'Admin sees all rooms, regular users see only active rooms.' })
  @ApiResponse({ status: 200, description: 'List of rooms', schema: { type: 'array', items: { example: roomExample } } })
  @Get()
  // @UseInterceptors(RoleCacheInterceptor)
  // @CacheTTL(30000) // 30 seconds
  findAll(@CurrentUser() user: AuthUser) {
    return this.roomsService.findAll(user.role);
  }

  @ApiOperation({ summary: 'Search available rooms', description: 'Only active rooms that are free for the date range are returned (checkIn and checkOut must be sent together). Cheapest first.' })
  @ApiResponse({ status: 200, description: 'Matching rooms', schema: { example: { message: 'Rooms retrieved successfully', count: 1, data: [roomExample] } } })
  @ApiResponse({ status: 400, description: 'Bad Request - invalid query (e.g. only one date, or checkIn not before checkOut)' })
  @Get('search')
  search(@Query() query: SearchRoomsDto) {
    return this.roomsService.search(query);
  }

  @ApiOperation({ summary: 'View room details', description: 'Includes imageUrl. Regular users cannot see deactivated rooms. Cached for 30 seconds.' })
  @ApiResponse({ status: 200, description: 'Room details', schema: { example: roomExample } })
  @ApiResponse({ status: 404, description: 'Room not found' })
  @Get(':id')
  @UseInterceptors(RoleCacheInterceptor)
  @CacheTTL(30000) // 30 seconds
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.roomsService.findOne(id, user.role);
  }

  @ApiOperation({ summary: 'Create a room (Admin)', description: 'Send as multipart/form-data. The image file is optional.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'capacity', 'pricePerNight'],
      properties: {
        name: { type: 'string', example: 'Deluxe Sea View' },
        capacity: { type: 'integer', minimum: 1, maximum: 50, example: 2 },
        pricePerNight: { type: 'number', example: 2500 },
        imageUrl: { type: 'string', example: 'http://localhost:3000/uploads/rooms/room1.jpg', description: 'Optional image URL (ignored if a file is uploaded)' },
        file: { type: 'string', format: 'binary', description: 'Optional room image (JPG, PNG or WEBP, max 10 MB)' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Room created successfully', schema: { example: { message: 'Room created successfully', data: roomExample } } })
  @ApiResponse({ status: 400, description: 'Bad Request - invalid or incomplete data' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin only' })
  @Post()
  @Roles(user_role.ADMIN)
  @UseInterceptors(roomImageInterceptor)
  async create(
    @Body() createRoomDto: CreateRoomDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const imageUrl = file ? `/uploads/rooms/${file.filename}` : undefined;
    const result = await this.roomsService.create(createRoomDto, imageUrl);
    await this.invalidateRooms();
    return result;
  }

  @ApiOperation({ summary: 'Upload / replace room image (Admin)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary', description: 'JPG, PNG or WEBP, max 10 MB' } } } })
  @ApiResponse({ status: 200, description: 'Room image updated successfully', schema: { example: { message: 'Room 1 image updated successfully', data: roomExample } } })
  @ApiResponse({ status: 400, description: 'Bad Request - image file missing or wrong type' })
  @ApiResponse({ status: 404, description: 'Room not found' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin only' })
  @Patch(':id/image')
  @Roles(user_role.ADMIN)
  @UseInterceptors(roomImageInterceptor)
  async uploadImage(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Image file is required');
    const result = await this.roomsService.setImage(id, user.role, `/uploads/rooms/${file.filename}`);
    await this.invalidateRooms();
    return result;
  }

  @ApiOperation({ summary: 'Edit a room (Admin)', description: 'Send as multipart/form-data. Every field is optional.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'Deluxe Sea View' },
        capacity: { type: 'integer', minimum: 1, maximum: 50, example: 2 },
        pricePerNight: { type: 'number', example: 2500 },
        imageUrl: { type: 'string', example: 'http://localhost:3000/uploads/rooms/room1.jpg', description: 'Optional image URL (ignored if a file is uploaded)' },
        isActive: { type: 'boolean', example: true },
        file: { type: 'string', format: 'binary', description: 'Optional room image (JPG, PNG or WEBP, max 10 MB)' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Room updated successfully', schema: { example: { message: 'Room 1 updated successfully', data: roomExample } } })
  @ApiResponse({ status: 400, description: 'Bad Request - invalid data' })
  @ApiResponse({ status: 404, description: 'Room not found' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin only' })
  @Patch(':id')
  @Roles(user_role.ADMIN)
  @UseInterceptors(roomImageInterceptor)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateRoomDto: UpdateRoomDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const imageUrl = file ? `/uploads/rooms/${file.filename}` : undefined;
    const result = await this.roomsService.update(id, updateRoomDto, imageUrl);
    await this.invalidateRooms();
    return result;
  }

  @ApiOperation({ summary: 'Deactivate a room (Admin)', description: 'Hides the room from regular users and from search.' })
  @ApiResponse({ status: 200, description: 'Room deactivated', schema: { example: { ...roomExample, isActive: false } } })
  @ApiResponse({ status: 404, description: 'Room not found' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin only' })
  @Patch(':id/disable')
  @Roles(user_role.ADMIN)
  async disable(@Param('id', ParseIntPipe) id: number) {
    const result = await this.roomsService.disable(id);
    await this.invalidateRooms();
    return result;
  }

  @ApiOperation({ summary: 'Activate a room (Admin)' })
  @ApiResponse({ status: 200, description: 'Room activated', schema: { example: roomExample } })
  @ApiResponse({ status: 404, description: 'Room not found' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin only' })
  @Patch(':id/enable')
  @Roles(user_role.ADMIN)
  async enable(@Param('id', ParseIntPipe) id: number) {
    const result = await this.roomsService.enable(id);
    await this.invalidateRooms();
    return result;
  }

  @ApiOperation({ summary: 'Delete a room (Admin)', description: 'Rooms that already have bookings cannot be deleted. Deactivate them instead.' })
  @ApiResponse({ status: 200, description: 'Room removed successfully', schema: { example: { message: 'Room 1 removed successfully', data: roomExample } } })
  @ApiResponse({ status: 400, description: 'Bad Request - room has related bookings' })
  @ApiResponse({ status: 404, description: 'Room not found' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin only' })
  @Delete(':id')
  @Roles(user_role.ADMIN)
  async remove(@Param('id', ParseIntPipe) id: number) {
    const result = await this.roomsService.remove(id);
    await this.invalidateRooms();
    return result;
  }
}