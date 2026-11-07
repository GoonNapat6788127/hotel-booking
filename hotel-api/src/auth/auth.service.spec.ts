import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { user_role } from '@prisma/client';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './decorators/current-user.decorator';

// Loosely typed jest.fn() so mockResolvedValue(...) accepts any value.
const fn = () => jest.fn<(...args: any[]) => any>();

// Mock PrismaService: only the methods AuthService actually calls.
const mockPrismaService = {
  user: {
    findUnique: fn(),
    create: fn(),
  },
  revokedtoken: {
    upsert: fn(),
    deleteMany: fn(),
  },
};

const mockJwtService = {
  sign: fn(),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------- register
  describe('register', () => {
    const dto = {
      email: 'alice@example.com',
      password: 'password123',
      name: 'Alice',
    };

    it('should hash the password and create a user with default USER role', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue({
        id: 1,
        email: dto.email,
        name: dto.name,
        role: user_role.USER,
      });

      const result = await service.register(dto as any);

      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: dto.email },
      });
      expect(mockPrismaService.user.create).toHaveBeenCalledTimes(1);

      const createArg = mockPrismaService.user.create.mock.calls[0][0] as any;
      expect(createArg.data.email).toBe(dto.email);
      expect(createArg.data.name).toBe(dto.name);
      expect(createArg.data.role).toBe(user_role.USER);
      // Stored value must be a hash of the password, never the plain text.
      expect(createArg.data.passwordHash).not.toBe(dto.password);
      expect(await bcrypt.compare(dto.password, createArg.data.passwordHash)).toBe(true);

      expect(result).toEqual({
        message: 'User registered successfully',
        user: { id: 1, email: dto.email, name: dto.name, role: user_role.USER },
      });
    });

    it('should use the role from the DTO when provided', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue({
        id: 2,
        email: dto.email,
        name: dto.name,
        role: user_role.ADMIN,
      });

      await service.register({ ...dto, role: user_role.ADMIN } as any);

      const createArg = mockPrismaService.user.create.mock.calls[0][0] as any;
      expect(createArg.data.role).toBe(user_role.ADMIN);
    });

    it('should not return the password hash', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue({
        id: 1,
        email: dto.email,
        name: dto.name,
        role: user_role.USER,
        passwordHash: 'should-not-leak',
      });

      const result = await service.register(dto as any);

      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('should throw ConflictException if the email already exists', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 1, email: dto.email });

      await expect(service.register(dto as any)).rejects.toThrow(ConflictException);
      expect(mockPrismaService.user.create).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------ validateUser
  describe('validateUser', () => {
    const plainPassword = 'password123';
    let dbUser: any;

    beforeAll(async () => {
      dbUser = {
        id: 1,
        email: 'alice@example.com',
        name: 'Alice',
        role: user_role.USER,
        passwordHash: await bcrypt.hash(plainPassword, 4),
      };
    });

    it('should return the user without passwordHash when credentials are valid', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(dbUser);

      const result = await service.validateUser(dbUser.email, plainPassword);

      expect(result).toEqual({
        id: 1,
        email: dbUser.email,
        name: 'Alice',
        role: user_role.USER,
      });
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('should return null when the user does not exist', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      const result = await service.validateUser('nobody@example.com', 'x');

      expect(result).toBeNull();
    });

    it('should return null when the password is wrong', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(dbUser);

      const result = await service.validateUser(dbUser.email, 'wrong-password');

      expect(result).toBeNull();
    });
  });

  // ------------------------------------------------------------------- login
  describe('login', () => {
    const dto = { email: 'alice@example.com', password: 'password123' };

    it('should return an access token with the correct payload', async () => {
      const validateSpy = jest.spyOn(service, 'validateUser').mockResolvedValue({
        id: 1,
        email: dto.email,
        name: 'Alice',
        role: user_role.USER,
      } as any);
      mockJwtService.sign.mockReturnValue('signed-jwt');

      const result = await service.login(dto as any);

      expect(validateSpy).toHaveBeenCalledWith(dto.email, dto.password);
      expect(mockJwtService.sign).toHaveBeenCalledWith(
        { sub: 1, email: dto.email, role: user_role.USER },
        { jwtid: expect.any(String) },
      );
      expect(result).toEqual({ access_token: 'signed-jwt' });
    });

    it('should generate a unique jwtid for each login', async () => {
      jest.spyOn(service, 'validateUser').mockResolvedValue({
        id: 1,
        email: dto.email,
        role: user_role.USER,
      } as any);
      mockJwtService.sign.mockReturnValue('signed-jwt');

      await service.login(dto as any);
      await service.login(dto as any);

      const jti1 = (mockJwtService.sign.mock.calls[0][1] as any).jwtid;
      const jti2 = (mockJwtService.sign.mock.calls[1][1] as any).jwtid;
      expect(jti1).not.toEqual(jti2);
    });

    it('should throw UnauthorizedException for invalid credentials', async () => {
      jest.spyOn(service, 'validateUser').mockResolvedValue(null);

      await expect(service.login(dto as any)).rejects.toThrow(UnauthorizedException);
      expect(mockJwtService.sign).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------ logout
  describe('logout', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const authUser = { id: 1, jti: 'jti-123', exp } as unknown as AuthUser;

    it('should revoke the token using its jti and expiry', async () => {
      mockPrismaService.revokedtoken.upsert.mockResolvedValue({});
      mockPrismaService.revokedtoken.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.logout(authUser);

      expect(mockPrismaService.revokedtoken.upsert).toHaveBeenCalledWith({
        where: { jti: 'jti-123' },
        update: {},
        create: { jti: 'jti-123', expiresAt: new Date(exp * 1000) },
      });
      expect(result).toEqual({ message: 'Logged out successfully' });
    });

    it('should clean up expired revoked tokens', async () => {
      mockPrismaService.revokedtoken.upsert.mockResolvedValue({});
      mockPrismaService.revokedtoken.deleteMany.mockResolvedValue({ count: 3 });

      await service.logout(authUser);

      expect(mockPrismaService.revokedtoken.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      });
    });

    it('should be idempotent when the same token is logged out twice', async () => {
      mockPrismaService.revokedtoken.upsert.mockResolvedValue({});
      mockPrismaService.revokedtoken.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.logout(authUser)).resolves.toBeDefined();
      await expect(service.logout(authUser)).resolves.toBeDefined();

      expect(mockPrismaService.revokedtoken.upsert).toHaveBeenCalledTimes(2);
    });
  });
});