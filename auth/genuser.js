const bcrypt = require('bcryptjs');

// Generate password hash for TestTV1
bcrypt.hash('TestTV1', 10).then((hash) => {
  console.log('\n=== MongoDB User Document ===\n');
  console.log(JSON.stringify({
    email: 'test@test.com',
    passwordHash: hash,
    name: 'Test User',
    createdAt: new Date(),
    updatedAt: new Date()
  }, null, 2));
  console.log('\n=== MongoDB Insert Command ===\n');
  console.log(`db.users.insertOne(${JSON.stringify({
    email: 'test@test.com',
    passwordHash: hash,
    name: 'Test User'
  }, null, 2)})`);
  console.log('\n=== Hash Only ===\n');
  console.log(hash);
}).catch(console.error);
