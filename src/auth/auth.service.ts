import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PersonalService } from 'src/personal/personal.service';
import { AuthPayloadDto } from './dto/login.dto';
import { DatabaseService } from 'src/database/database.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import { jwtSecret } from '../utils/constants';
import * as dotenv from 'dotenv';
dotenv.config();

@Injectable()
export class AuthService {
  constructor(
    private databaseService: DatabaseService,
    private jwt: JwtService,
  ) {}

  async signup(dto: AuthPayloadDto) {
    const { username, password } = dto;

    const foundUser = await this.databaseService.userdata.findUnique({
      where: { username },
    });

    if (foundUser) {
      throw new BadGatewayException('Email already exists');
    }

    const hashedpassword = await this.hashPassword(password);

    await this.databaseService.userdata.create({
      data: {
        username,
        hashedpassword,
      },
    });

    return { message: 'signup was successful' };
  }

  async signin(dto: AuthPayloadDto, req: Request, res: Response) {
    const { username, password } = dto;

    const foundUser = await this.databaseService.userdata.findUnique({
      where: { username },
    });

    if (!foundUser) {
      throw new BadGatewayException('Wrong credentials');
    }

    const isMatch = await this.comparePasswords({
      password,
      hash: foundUser.hashedpassword as string,
    });

    if (!isMatch) {
      throw new BadGatewayException('Wrong credentials');
    }

    const token = await this.signToken({
      id: foundUser.id,
      username: foundUser.username,
    });

    if (!token) {
      throw new ForbiddenException();
    }

    res.cookie('token', token);

    return res.send({ message: 'Logged in successfully' });
  }

  async hashPassword(password: string) {
    const saltOrRounds = 10;

    return await bcrypt.hash(password, saltOrRounds);
  }

  async comparePasswords(args: { password: string; hash: string }) {
    return await bcrypt.compare(args.password, args.hash);
  }

  async signToken(args: { id: number; username: string }) {
    const payload = args;

    return this.jwt.signAsync(payload, { secret: jwtSecret });
  }
}
