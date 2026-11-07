import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { AuthUser } from './decorators/current-user.decorator';

// Loosely typed jest.fn() so mockResolvedValue(...) accepts any value.
const fn = () => jest.fn<(...args: any[]) => any>();

// The controller only delegates, so we mock the whole service.
const mockAuthService = {
  register: fn(),
  login: fn(),
  logout: fn(),
};

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    })
      // Bypass real JWT validation: this is a unit test of the controller only.
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('register', () => {
    const dto = { email: 'alice@example.com', password: 'password123', name: 'Alice' };

    it('should call authService.register and return its result', async () => {
      const result = {
        message: 'User registered successfully',
        user: { id: 1, email: dto.email, name: dto.name, role: 'USER' },
      };
      mockAuthService.register.mockResolvedValue(result);

      expect(await controller.register(dto as any)).toBe(result);
      expect(mockAuthService.register).toHaveBeenCalledWith(dto);
    });

    it('should propagate ConflictException from the service', async () => {
      mockAuthService.register.mockRejectedValue(new ConflictException());

      await expect(controller.register(dto as any)).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    const dto = { email: 'alice@example.com', password: 'password123' };

    it('should call authService.login and return the access token', async () => {
      const result = { access_token: 'signed-jwt' };
      mockAuthService.login.mockResolvedValue(result);

      expect(await controller.login(dto as any)).toBe(result);
      expect(mockAuthService.login).toHaveBeenCalledWith(dto);
    });

    it('should propagate UnauthorizedException from the service', async () => {
      mockAuthService.login.mockRejectedValue(new UnauthorizedException());

      await expect(controller.login(dto as any)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('should call authService.logout with the current user', async () => {
      const user = { id: 1, jti: 'jti-123', exp: 1999999999 } as unknown as AuthUser;
      const result = { message: 'Logged out successfully' };
      mockAuthService.logout.mockResolvedValue(result);

      expect(await controller.logout(user)).toBe(result);
      expect(mockAuthService.logout).toHaveBeenCalledWith(user);
    });
  });
});