import { randomMasterKey } from '../security/crypto.js';

console.log(randomMasterKey().toString('base64'));
