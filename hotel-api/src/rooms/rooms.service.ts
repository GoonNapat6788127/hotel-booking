import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, user_role } from '@prisma/client';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { SearchRoomsDto } from './dto/search-room.dto';
import { overlapWhere } from '../bookings/booking-overlap';

@Injectable()
export class RoomsService {
  constructor(private readonly prisma: PrismaService) { }

  // delete a local room image; never throws
  private async deleteLocalImage(imageUrl?: string | null) {
    if (imageUrl?.startsWith('/uploads/rooms/')) {
      await unlink(join(process.cwd(), imageUrl)).catch(() => { });
    }
  }

  async create(createRoomDto: CreateRoomDto, imageUrl?: string) {
    try {
      const room = await this.prisma.room.create({
        data: { ...createRoomDto, ...(imageUrl && { imageUrl }) },
      });

      return {
        message: 'Room created successfully',
        data: room,
      };
    } catch (e: any) {
      // create failed -> remove the uploaded file
      await this.deleteLocalImage(imageUrl);
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

  async update(id: number, updateRoomDto: UpdateRoomDto, imageUrl?: string) {
    try {
      const existing = await this.prisma.room.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException(`Room with ID ${id} not found`);
      }

      const updated = await this.prisma.room.update({
        where: { id },
        data: { ...updateRoomDto, ...(imageUrl && { imageUrl }) },
      });

      // success + new image uploaded -> remove the previous file
      if (imageUrl) {
        await this.deleteLocalImage(existing.imageUrl);
      }

      return {
        message: `Room ${id} updated successfully`,
        data: updated,
      };
    }
    catch (e: any) {
      // failed -> remove the NEW file multer already saved
      await this.deleteLocalImage(imageUrl);

      if (e instanceof NotFoundException) throw e;
      if (e?.code === 'P2025') {
        throw new NotFoundException(`Room with ID ${id} not found`);
      }

      throw new BadRequestException(e?.message ?? 'Update room failed');
    }
  }

  async remove(id: number) {
    try {
      const deleted = await this.prisma.room.delete({
        where: { id },
      });

      // DB delete succeeded -> remove the image file
      await this.deleteLocalImage(deleted.imageUrl);

      return {
        message: `Room ${id} removed successfully`,
        data: deleted,
      };
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
    try {
      const room = await this.findOne(id, role); // 404 if not found
      const oldImageUrl = room.imageUrl;

      const updated = await this.prisma.room.update({
        where: { id },
        data: { imageUrl },
      });

      // success -> remove the previous file
      await this.deleteLocalImage(oldImageUrl);

      return {
        message: `Room ${id} image updated successfully`,
        data: updated,
      };
    }
    catch (e) {
      // failed -> remove the NEW file that multer already saved
      await this.deleteLocalImage(imageUrl);
      throw e; // keep the original 404 / error
    }
  }

  async search(q: SearchRoomsDto) {
    const { checkIn, checkOut, capacity, maxPrice } = q;

    if ((checkIn && !checkOut) || (!checkIn && checkOut)) {
      throw new BadRequestException('Provide both checkIn and checkOut');
    }
    if (checkIn && checkOut && checkIn >= checkOut) {
      throw new BadRequestException('Check-in must be before check-out');
    }

    const where: Prisma.roomWhereInput = { isActive: true };

    if (capacity) where.capacity = { gte: capacity };
    if (maxPrice !== undefined) where.pricePerNight = { lte: maxPrice };
    if (checkIn && checkOut) where.booking = { none: overlapWhere(checkIn, checkOut) };

    const rooms = await this.prisma.room.findMany({
      where,
      orderBy: { pricePerNight: 'asc' },
    });
    return { message: 'Rooms retrieved successfully', count: rooms.length, data: rooms };
  }
}