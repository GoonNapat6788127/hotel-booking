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

  @Get()
  // @UseInterceptors(RoleCacheInterceptor)
  // @CacheTTL(30000) // 30 seconds
  findAll(@CurrentUser() user: AuthUser) {
    return this.roomsService.findAll(user.role);
  }

  @Get('search')
  search(@Query() query: SearchRoomsDto) {
    return this.roomsService.search(query);
  }

  @Get(':id')
  @UseInterceptors(RoleCacheInterceptor)
  @CacheTTL(30000) // 30 seconds
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.roomsService.findOne(id, user.role);
  }

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

  @Patch(':id/disable')
  @Roles(user_role.ADMIN)
  async disable(@Param('id', ParseIntPipe) id: number) {
    const result = await this.roomsService.disable(id);
    await this.invalidateRooms();
    return result;
  }

  @Patch(':id/enable')
  @Roles(user_role.ADMIN)
  async enable(@Param('id', ParseIntPipe) id: number) {
    const result = await this.roomsService.enable(id);
    await this.invalidateRooms();
    return result;
  }

  @Delete(':id')
  @Roles(user_role.ADMIN)
  async remove(@Param('id', ParseIntPipe) id: number) {
    const result = await this.roomsService.remove(id);
    await this.invalidateRooms();
    return result;
  }
}