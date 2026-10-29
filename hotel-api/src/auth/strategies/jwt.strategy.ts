import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(private prisma: PrismaService) {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
            throw new Error('JWT_SECRET is not set. Define it in your environment or .env file.');
        }

        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: secret,
        });
    }

    async validate(payload: any) {
        const revoked = await this.prisma.revokedtoken.findUnique({ where: { jti: payload.jti } });
        if (revoked) throw new UnauthorizedException('Token has been revoked (logged out)');
        return {
            id: payload.sub,
            email: payload.email,
            role: payload.role,
            jti: payload.jti,
            exp: payload.exp,
        };
    }
}