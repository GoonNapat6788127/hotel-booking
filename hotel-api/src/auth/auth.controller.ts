import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('auth')
@ApiResponse({ status: 429, description: 'Too Many Requests' })
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: 'Register a new account', description: 'Public. Creates a USER account (send role ADMIN to create an admin). The password is hashed and never returned.' })
  @ApiResponse({ status: 201, description: 'User registered successfully', schema: { example: { message: 'User registered successfully', user: { id: 1, email: 'john@example.com', name: 'John Doe', role: 'USER' } } } })
  @ApiResponse({ status: 400, description: 'Bad Request - invalid or incomplete data' })
  @ApiResponse({ status: 409, description: 'Conflict - email already registered' })
  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @ApiOperation({ summary: 'Log in', description: 'Public. Returns a JWT. Click Authorize in Swagger UI and paste the access_token.' })
  @ApiResponse({ status: 200, description: 'Login successful', schema: { example: { access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' } } })
  @ApiResponse({ status: 400, description: 'Bad Request - invalid or incomplete data' })
  @ApiResponse({ status: 401, description: 'Unauthorized - invalid credentials' })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Log out', description: 'Revokes the current token so it cannot be used again.' })
  @ApiResponse({ status: 200, description: 'Logged out successfully', schema: { example: { message: 'Logged out successfully' } } })
  @ApiResponse({ status: 401, description: 'Unauthorized - missing, invalid or revoked token' })
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@CurrentUser() user: AuthUser) {
    return this.authService.logout(user);
  }
}