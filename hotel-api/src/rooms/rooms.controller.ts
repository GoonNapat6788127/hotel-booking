import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, ParseIntPipe, UseInterceptors, BadRequestException, UploadedFile, Query } from '@nestjs/common';
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

const roomImageInterceptor = FileInterceptor('file', {
  storage: diskStorage({
    destination: './uploads/rooms',
    filename: (req, file, cb) =>
      cb(null, `${randomUUID()}${extname(file.originalname)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB (use 100 * 1024 * 1024 if you really want 100 MB)
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
  constructor(private readonly roomsService: RoomsService) { }

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.roomsService.findAll(user.role);
  }

  @Get('search')
  search(@Query() query: SearchRoomsDto) {
    return this.roomsService.search(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.roomsService.findOne(id, user.role);
  }

  @Post()
  @Roles(user_role.ADMIN)
  @UseInterceptors(roomImageInterceptor)
  create(
    @Body() createRoomDto: CreateRoomDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const imageUrl = file ? `/uploads/rooms/${file.filename}` : undefined;
    return this.roomsService.create(createRoomDto, imageUrl);
  }

  @Patch(':id/image')
  @Roles(user_role.ADMIN)
  @UseInterceptors(roomImageInterceptor)
  uploadImage(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Image file is required');
    return this.roomsService.setImage(id, user.role, `/uploads/rooms/${file.filename}`);
  }

  @Patch(':id')
  @Roles(user_role.ADMIN)
  @UseInterceptors(roomImageInterceptor)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateRoomDto: UpdateRoomDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const imageUrl = file ? `/uploads/rooms/${file.filename}` : undefined;
    return this.roomsService.update(id, updateRoomDto, imageUrl);
  }

  @Patch(':id/disable')
  @Roles(user_role.ADMIN)
  disable(@Param('id', ParseIntPipe) id: number) {
    return this.roomsService.disable(id);
  }

  @Patch(':id/enable')
  @Roles(user_role.ADMIN)
  enable(@Param('id', ParseIntPipe) id: number) {
    return this.roomsService.enable(id);
  }

  @Delete(':id')
  @Roles(user_role.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.roomsService.remove(id);
  }

}
