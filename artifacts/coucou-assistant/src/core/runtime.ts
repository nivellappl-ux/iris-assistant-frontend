import { IrisCore } from './irisCore';
import { LocalProvider } from './localProvider';

export const irisCore = new IrisCore();
irisCore.registerProvider(new LocalProvider());