import { describe, expect, it } from 'vitest';
import { classifySendError } from '../src/handoff/send-errors';

describe('classifySendError', () => {
  it.each<unknown>([
    new Error('Could not establish connection. Receiving end does not exist.'),
    'Could not establish connection. Receiving end does not exist.',
    new Error('receiving end does not exist'),
  ])('classifies %j as no_receiver', (error) => {
    expect(classifySendError(error)).toBe('no_receiver');
  });

  it.each<unknown>([
    new Error('The message port closed before a response was received.'),
    new Error(
      'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received',
    ),
  ])('classifies %j as port_closed', (error) => {
    expect(classifySendError(error)).toBe('port_closed');
  });

  it.each<unknown>([new Error('Cannot access contents of url'), undefined, 42, {}])(
    'classifies %j as other',
    (error) => {
      expect(classifySendError(error)).toBe('other');
    },
  );
});