import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { PersonalModule } from './personal/personal.module';
import { AuthModule } from './auth/auth.module';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [DatabaseModule, PersonalModule, AuthModule, JwtModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
