import { loadEnvFile } from 'node:process';

// Local worker commands use the same .env convention as the web development server.
// Explicit environment variables take precedence; deployed workers need no .env file.
try {
	loadEnvFile();
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
