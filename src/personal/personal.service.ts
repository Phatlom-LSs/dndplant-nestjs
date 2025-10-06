import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class PersonalService {
  constructor(private databaseService: DatabaseService) {}

  async create(createPersonalDto: Prisma.userdataCreateInput) {
    return this.databaseService.userdata.create({ data: createPersonalDto });
  }

  async findAll() {
    return this.databaseService.userdata.findMany({
      select: { id: true, username: true },
    });
  }

  async findOne(id: number) {
    const user = await this.databaseService.userdata.findUnique({
      where: {
        id,
      },
      select: {
        id: true,
        username: true,
        hashedpassword: true,
      },
    });
    return { user };
  }

  async remove(id: number) {
    return this.databaseService.userdata.delete({
      where: {
        id,
      },
    });
  }

  async patch(id: number, updateProductDto: Prisma.userdataUpdateInput) {
    return this.databaseService.userdata.update({
      where: {
        id,
      },
      data: updateProductDto,
    });
  }
}
