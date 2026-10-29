import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { PrismaService } from '../prisma/prisma.service';
import { user_role } from '@prisma/client';
import { unlink } from 'fs/promises';
import { join } from 'path';

@Injectable()
export class RoomsService {
  constructor(private readonly prisma: PrismaService) { }

  async create(createRoomDto: CreateRoomDto, imageUrl?: string) {
    try {
      return await this.prisma.room.create({
        data: { ...createRoomDto, ...(imageUrl && { imageUrl }) },
      });
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? 'Create room failed');
    }
  }

  async findAll(role: user_role) {
    return this.prisma.room.findMany({
      where: role === user_role.ADMIN
        ? {}
        : { isActive: true },
    });
  }

  async findOne(id: number, role: user_role) {
    const room = await this.prisma.room.findUnique({
      where: {
        id: id,
        ...(role !== user_role.ADMIN && { isActive: true }),
      },
    });

    if (!room) {
      throw new NotFoundException(`Room ${id} not found`);
    }

    return room;
  }

  async update(id: number, updateRoomDto: UpdateRoomDto) {
    try {
      return await this.prisma.room.update({
        where: { id },
        data: updateRoomDto,
      });
    }
    catch (e: any) {
      if (e?.code === 'P2025') {
        throw new NotFoundException(`Room with ID ${id} not found`);
      }

      throw new BadRequestException(
        e?.message ?? 'Update room failed',
      );
    }
  }

  async remove(id: number) {
    try {
      return await this.prisma.room.delete({
        where: { id },
      });
    }
    catch (e: any) {
      if (e?.code === 'P2025') {
        throw new NotFoundException(`Room with ID ${id} not found`);
      }

      if (e?.code === 'P2003') {
        throw new BadRequestException(
          'Cannot delete this room because it has related bookings',
        );
      }

      throw new BadRequestException(
        e?.message ?? 'Delete room failed',
      );
    }
  }

  async enable(id: number) {
    try {
      return await this.prisma.room.update({
        where: { id },
        data: { isActive: true },
      });
    }
    catch (e: any) {
      if (e?.code === 'P2025') {
        throw new NotFoundException(`Room with ID ${id} not found`);
      }

      throw new BadRequestException(
        e?.message ?? 'Enable room failed',
      );
    }
  }

  async disable(id: number) {
    try {
      return await this.prisma.room.update({
        where: { id },
        data: { isActive: false },
      });
    }
    catch (e: any) {
      if (e?.code === 'P2025') {
        throw new NotFoundException(`Room with ID ${id} not found`);
      }

      throw new BadRequestException(
        e?.message ?? 'Disable room failed',
      );
    }
  }

  async setImage(id: number, role: user_role, imageUrl: string) {
  const room = await this.findOne(id, role); // 404 if not found
  const oldImageUrl = room.imageUrl;

  const updated = await this.prisma.room.update({
    where: { id },
    data: { imageUrl },
  });

  // delete the previous local file so its URL stops working
  if (oldImageUrl?.startsWith('/uploads/rooms/')) {
    await unlink(join(process.cwd(), oldImageUrl)).catch(() => {});
  }

  return updated;
}
}
