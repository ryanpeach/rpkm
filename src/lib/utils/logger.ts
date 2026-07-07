import pino from "pino";

export const makeLogger = (name: string, level: string) => pino({ name, level });
