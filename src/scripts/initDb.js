const { initializeStorage } = require('../services/storage');

initializeStorage()
  .then(() => {
    console.log('Firestore initialized successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Firestore initialization failed.', error);
    process.exit(1);
  });
