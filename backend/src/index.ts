import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const port = Number(process.env.PORT ?? 2211);

createApp(config).listen(port, () => {
  console.log(`UWAT inventory API on :${port}`);
});
