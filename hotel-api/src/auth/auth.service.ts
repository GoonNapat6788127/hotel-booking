import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';
import { user_role } from '@prisma/client';
import { SAFE_USER_SELECT } from '../users/user.select';
import { JwtService } from '@nestjs/jwt';
import type { AuthUser } from './decorators/current-user.decorator';
import { randomUUID } from 'crypto';

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 10;

@Injectable()
export class AuthService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly jwtService: JwtService,
    ) { }

    async register(registerDto: RegisterDto) {
        const { email, password, name, role } = registerDto;

        const existingUser = await this.prisma.user.findUnique({
            where: { email },
        });

        if (existingUser) {
            throw new ConflictException('User with this email already exists');
        }

        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

        const user = await this.prisma.user.create({
            data: {
                email,
                passwordHash: passwordHash,
                name,
                role: role ?? user_role.USER,
            },
            select: SAFE_USER_SELECT,
        });

        return {
            message: 'User registered successfully',
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
            },
        };
    }

    async validateUser(email: string, password: string) {
        const user = await this.prisma.user.findUnique({ where: { email } });
        if (user && (await bcrypt.compare(password, user.passwordHash))) {
            const { passwordHash, ...result } = user;
            return result;
        }
        return null;
    }

    async login(LoginDto: LoginDto) {
        const user = await this.validateUser(LoginDto.email, LoginDto.password);
        if (!user) {
            throw new UnauthorizedException('Invalid credentials');
        }   

        const payload = { sub: user.id, email: user.email, role: user.role };
        return {
            access_token: this.jwtService.sign(payload, { jwtid: randomUUID() }),
        };
    }

    async logout(user: AuthUser) {
    await this.prisma.revokedtoken.upsert({
      where: { jti: user.jti },
      update: {},
      create: { jti: user.jti, expiresAt: new Date(user.exp * 1000) },
    });
    await this.prisma.revokedtoken.deleteMany({ where: { expiresAt: { lt: new Date() } } });

    return { message: 'Logged out successfully'};
  }
}