import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

describe('AppController', () => {
  let appController: AppController;
  let dbAvailable: boolean;

  // Fake PrismaService: $queryRaw succeeds or fails depending on dbAvailable.
  const prismaStub = {
    $queryRaw: async () => {
      if (!dbAvailable) throw new Error('connection refused');
      return [{ 1: 1 }];
    },
  };

  beforeEach(async () => {
    dbAvailable = true;
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: PrismaService, useValue: prismaStub }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    it('returns status ok and database up when the database answers', async () => {
      const result = await appController.health();
      expect(result.status).toBe('ok');
      expect(result.database).toBe('up');
      expect(typeof result.uptime).toBe('number');
      expect(typeof result.timestamp).toBe('string');
    });

    it('throws 503 ServiceUnavailableException when the database is down', async () => {
      dbAvailable = false;
      await expect(appController.health()).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('reports database down in the 503 response body', async () => {
      dbAvailable = false;
      try {
        await appController.health();
        throw new Error('expected health() to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ServiceUnavailableException);
        const body = (e as ServiceUnavailableException).getResponse() as any;
        expect(body.status).toBe('error');
        expect(body.database).toBe('down');
      }
    });
  });
});