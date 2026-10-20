import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { PrismaService } from '../prisma/prisma.service';
import { SAFE_USER_SELECT } from './user.select';
import * as bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 10;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) { }

  // FR-3
  async getProfile(id: number) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: SAFE_USER_SELECT });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // FR-4
  async updateProfile(id: number, UpdateUserDto: UpdateUserDto) {
    const data: { name?: string; passwordHash?: string } = {};
    if (UpdateUserDto.name !== undefined) data.name = UpdateUserDto.name;
    if (UpdateUserDto.password !== undefined) data.passwordHash = await bcrypt.hash(UpdateUserDto.password, BCRYPT_ROUNDS);

    try{
      const user = await this.prisma.user.update({ where: { id }, data, select: SAFE_USER_SELECT });
      this.logger.log(`Profile updated id=${id}`);
      return { message: 'Profile updated successfully', data: user };
    }
    catch (e: any){
      throw e;
    }
  }
}