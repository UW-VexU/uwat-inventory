import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://connortan@localhost:5432/uwat_inventory_test' },
    globalSetup: './test/global-setup.ts',
    fileParallelism: false,
    include: ['test/**/*.test.ts'],
  },
});
