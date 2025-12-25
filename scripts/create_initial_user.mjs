import { Client } from 'pg';
import argon2 from 'argon2';

(async () => {
  const client = new Client({
    host: process.env.POSTGRESQL_HOST || 'postgres',
    port: Number(process.env.POSTGRESQL_PORT || 5432),
    user: process.env.POSTGRESQL_USER || 'postgres',
    password: process.env.POSTGRESQL_PASSWORD || 'postgres',
    database: process.env.POSTGRESQL_NAME || 'excdb'
  });

  await client.connect();

  try {
    const res = await client.query('SELECT count(*) FROM users');
    const count = Number(res.rows[0].count || 0);
    console.log('Users count:', count);

    if (count > 0) {
      console.log('Users already exist; aborting creation.');
      process.exit(0);
    }

    const name = process.env.TEST_USER_NAME || 'initial_admin';
    const email = process.env.TEST_USER_EMAIL || 'admin@example.test';
    const passwordPlain = process.env.TEST_USER_PASSWORD || 'Password123!';
    const hashed = await argon2.hash(passwordPlain);

    const insert = `INSERT INTO users (name, email, password, admin, demo, fee, active, level, email_verified, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now(), now()) RETURNING id, name, email, admin, active, level, email_verified`;

    const r = await client.query(insert, [name, email.toLowerCase(), hashed, true, false, -1, true, 9999, true]);

    console.log('Inserted user:', r.rows[0]);
  } catch (e) {
    console.error('Error:', e);
    process.exit(2);
  } finally {
    await client.end();
  }
})();
