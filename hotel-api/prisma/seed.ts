import "dotenv/config";
import { PrismaClient, user_role } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import * as bcrypt from "bcrypt";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not defined");
}

const adapter = new PrismaMariaDb(databaseUrl);
const prisma = new PrismaClient({ adapter });

async function main() {
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) {
        throw new Error('ADMIN_EMAIL is not defined');
    }
    const email = adminEmail.toLowerCase();

    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
        throw new Error('ADMIN_PASSWORD is not defined');
    }
    const passwordHash = await bcrypt.hash(adminPassword, 12);

    const existingAdmin = await prisma.user.findUnique({
        where: { email: email },
    });

    if (!existingAdmin) {
        const admin = await prisma.user.create({
            data: {
                email: email,
                passwordHash: passwordHash,
                name: 'Seed System Admin',
                role: user_role.ADMIN,
            },
        });
        console.log(`Admin user created: ${admin.email}`);
    } else {
        console.log(`Admin user already exists: ${existingAdmin.email}`);
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });