/**
 * Test script to verify OpenRouter API streaming
 */

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText } from 'ai';

const API_KEY = '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';
const MODEL = 'x-ai/grok-code-fast-1';

async function testOpenRouterStreaming() {
  console.log('Testing OpenRouter streaming...');
  console.log('API Key:', API_KEY.substring(0, 20) + '...');
  console.log('Model:', MODEL);
  console.log('---');

  try {
    const openrouter = createOpenRouter({ apiKey: API_KEY });
    const model = openrouter(MODEL);

    console.log('Model created, calling streamText...');

    const { fullStream } = streamText({
      model,
      messages: [
        { role: 'user', content: 'Say "hello" and nothing else.' },
      ],
    });

    console.log('streamText called, iterating chunks...');

    let chunkCount = 0;
    for await (const chunk of fullStream) {
      chunkCount++;
      console.log(`Chunk ${chunkCount}:`, chunk.type);

      if (chunk.type === 'text-delta') {
        console.log('  Text:', chunk.text);
      }

      if (chunk.type === 'finish') {
        console.log('  Finish reason:', chunk.finishReason);
        console.log('  Usage:', chunk.totalUsage);
      }
    }

    console.log('---');
    console.log('✅ Stream completed successfully!');
    console.log('Total chunks:', chunkCount);
  } catch (error) {
    console.error('❌ Error:', error);
    if (error instanceof Error) {
      console.error('Message:', error.message);
      console.error('Stack:', error.stack);
    }
  }
}

testOpenRouterStreaming();
