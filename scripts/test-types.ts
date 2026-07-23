// Test komutları için helper types
export type TestResult = {
  passed: boolean;
  message: string;
  error?: string;
};

export type SmokeTestSuite = {
  name: string;
  tests: TestResult[];
};
