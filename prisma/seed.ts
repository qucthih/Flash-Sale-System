import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const SAMPLE_PRODUCT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

async function main() {
  console.log('Seeding initial data...');

  // Reset database for a clean test run
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();

  const product = await prisma.product.create({
    data: {
      id: SAMPLE_PRODUCT_ID,
      name: 'iPhone 15 Pro Max 256GB (Flash Sale Edition)',
      stock: 10,
      price: 1199.99,
    },
  });

  console.log('✅ Seed completed successfully:');
  console.log(`   - Product ID: ${product.id}`);
  console.log(`   - Name:       ${product.name}`);
  console.log(`   - Stock:      ${product.stock}`);
  console.log(`   - Price:      $${product.price}`);
}

main()
  .catch((e) => {
    console.error('❌ Error while seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

