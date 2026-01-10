# Contributing to 1815 Cardano Service

Thank you for your interest in contributing! This document provides guidelines and information for contributors.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Release Process](#release-process)
- [Architecture Overview](#architecture-overview)

## Getting Started

### Prerequisites

- Node.js 20+
- MongoDB 5.0+
- Redis 6.0+
- Git

### Fork and Clone

```bash
# Fork the repository on GitHub, then:
git clone https://github.com/YOUR_USERNAME/1815.git
cd 1815
npm install
```

### Environment Setup

```bash
cp .env.template .env
# Edit .env with your configuration
```

Start dependencies:

```bash
# MongoDB
docker run -d -p 27017:27017 --name mongodb mongo:7.0

# Redis
docker run -d -p 6379:6379 --name redis redis:7.2-alpine
```

## Development Setup

### Install Dependencies

```bash
npm install
```

### Build

```bash
npm run build        # Production build
npm run build:dev    # Development build
```

### Run Tests

```bash
npm test                # Run all tests
npm run test:watch      # Watch mode
npm run test:coverage   # With coverage
```

### Lint and Format

```bash
npm run lint            # Check linting
npm run lint:fix        # Fix linting issues
npm run format          # Format code
npm run format:check    # Check formatting
```

### Run Standalone Server

```bash
npm run start:dev       # Development mode
npm start               # Production mode
```

## Project Structure

```
1815/
├── src/
│   ├── lib/              # Library entry point
│   │   └── index.ts      # Main export
│   ├── config/           # Configuration
│   ├── controllers/      # Route controllers
│   ├── middlewares/      # Express middlewares
│   ├── models/           # Database models
│   ├── routes/           # API routes
│   ├── services/         # Business logic
│   ├── jobs/             # Background jobs
│   ├── utils/            # Utilities
│   ├── types/            # TypeScript types
│   ├── index.ts          # Legacy entry (deprecated)
│   └── standalone.ts     # Standalone server
├── examples/             # Integration examples
├── docs/                 # Additional documentation
├── scripts/              # Build/deploy scripts
└── tests/                # Test files

Key Files:
- src/lib/index.ts        # Main library export
- src/standalone.ts       # Standalone server
- package.json            # Package configuration
- tsconfig.json           # TypeScript config
```

## Making Changes

### Branch Naming

- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation
- `refactor/description` - Code refactoring
- `test/description` - Test improvements

### Commit Messages

Follow conventional commits:

```
type(scope): description

[optional body]

[optional footer]
```

Types:

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Formatting
- `refactor`: Code restructuring
- `test`: Tests
- `chore`: Maintenance

Examples:

```
feat(alias): add bulk alias creation endpoint
fix(explorer): handle null transaction data
docs(readme): update installation instructions
```

### Code Style

- Use TypeScript
- Follow ESLint rules
- Use Prettier for formatting
- Write meaningful variable names
- Add comments for complex logic
- Keep functions small and focused

### Adding Features

1. Create a new branch
2. Implement the feature
3. Add tests
4. Update documentation
5. Submit a pull request

### Fixing Bugs

1. Create an issue describing the bug
2. Create a branch: `fix/issue-number-description`
3. Fix the bug
4. Add a test that would have caught the bug
5. Submit a pull request referencing the issue

## Testing

### Test Structure

```typescript
describe('Feature Name', () => {
  beforeAll(async () => {
    // Setup
  });

  afterAll(async () => {
    // Cleanup
  });

  it('should do something', async () => {
    // Test
    expect(result).toBe(expected);
  });
});
```

### Running Tests

```bash
# All tests
npm test

# Specific file
npm test -- path/to/test.ts

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

### Writing Tests

- Test happy paths
- Test error cases
- Test edge cases
- Use descriptive test names
- Keep tests isolated
- Mock external dependencies

## Submitting Changes

### Pull Request Process

1. **Update your fork**

   ```bash
   git checkout main
   git pull upstream main
   ```

2. **Create a branch**

   ```bash
   git checkout -b feature/my-feature
   ```

3. **Make changes**
   - Write code
   - Add tests
   - Update documentation

4. **Commit changes**

   ```bash
   git add .
   git commit -m "feat: add my feature"
   ```

5. **Push to your fork**

   ```bash
   git push origin feature/my-feature
   ```

6. **Create Pull Request**
   - Go to GitHub
   - Click "New Pull Request"
   - Fill in the template
   - Link related issues

### Pull Request Checklist

- [ ] Code follows project style
- [ ] Tests added/updated
- [ ] All tests pass
- [ ] Documentation updated
- [ ] Commit messages follow convention
- [ ] No merge conflicts
- [ ] PR description is clear

### Review Process

1. Automated checks run (tests, linting)
2. Maintainers review code
3. Address feedback
4. Approval and merge

## Release Process

### Version Numbers

We follow [Semantic Versioning](https://semver.org/):

- MAJOR: Breaking changes
- MINOR: New features (backward compatible)
- PATCH: Bug fixes

### Release Checklist

1. **Pre-release**
   - [ ] All tests passing
   - [ ] Documentation updated
   - [ ] CHANGELOG.md updated
   - [ ] Version bumped in package.json

2. **Build**

   ```bash
   npm run build
   npm test
   ```

3. **Tag**

   ```bash
   git tag v2.0.0
   git push origin v2.0.0
   ```

4. **Publish**

   ```bash
   npm publish --access public
   ```

5. **Post-release**
   - [ ] GitHub release created
   - [ ] Announcement posted
   - [ ] Documentation deployed

## Architecture Overview

### Library Architecture

```
┌─────────────────────────────────────┐
│     Your Application                │
│  ┌───────────────────────────────┐  │
│  │  1815 Service (Library)       │  │
│  │  ┌─────────┐  ┌────────────┐ │  │
│  │  │ Router  │  │  Services  │ │  │
│  │  └─────────┘  └────────────┘ │  │
│  │  ┌─────────┐  ┌────────────┐ │  │
│  │  │ Models  │  │    Jobs    │ │  │
│  │  └─────────┘  └────────────┘ │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│  MongoDB + Redis + Blockfrost       │
└─────────────────────────────────────┘
```

### Key Components

1. **Library Entry (`src/lib/index.ts`)**
   - Main export
   - Initialization function
   - Service instance

2. **Services (`src/services/`)**
   - Business logic
   - External API calls
   - Data processing

3. **Models (`src/models/`)**
   - Database schemas
   - Data validation
   - Mongoose models

4. **Routes (`src/routes/`)**
   - API endpoints
   - Request handling
   - Response formatting

5. **Jobs (`src/jobs/`)**
   - Background tasks
   - Scheduled jobs
   - Queue processing

### Data Flow

```
Request → Middleware → Controller → Service → Model → Database
                                      ↓
                                   External API
```

## Code Guidelines

### TypeScript

- Use strict mode
- Define interfaces for data structures
- Avoid `any` type
- Use type inference when possible

### Error Handling

```typescript
try {
  // Operation
} catch (error) {
  logger.error('Operation failed:', error);
  throw new AppError('User-friendly message', 500);
}
```

### Async/Await

- Use async/await over promises
- Handle errors properly
- Avoid callback hell

### Logging

```typescript
import { logger } from '@/utils/logger';

logger.info('Operation started');
logger.error('Operation failed:', error);
logger.warn('Warning message');
```

### Environment Variables

- Use `.env` for local development
- Never commit `.env` files
- Document all variables in `.env.template`
- Validate required variables on startup

## Getting Help

### Questions

- Check existing documentation
- Search GitHub issues
- Ask in GitHub Discussions
- Email: emmanuelodero@techmates.team

### Reporting Bugs

1. Check if bug already reported
2. Create detailed issue with:
   - Description
   - Steps to reproduce
   - Expected behavior
   - Actual behavior
   - Environment details
   - Error messages/logs

### Suggesting Features

1. Check if feature already requested
2. Create issue with:
   - Use case
   - Proposed solution
   - Alternatives considered
   - Additional context

## Code of Conduct

- Be respectful and inclusive
- Welcome newcomers
- Accept constructive criticism
- Focus on what's best for the project
- Show empathy towards others

## Recognition

Contributors will be:

- Listed in CHANGELOG.md
- Mentioned in release notes
- Added to GitHub contributors

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Thank You!

Your contributions make this project better for everyone. Thank you for taking the time to contribute!

---

**Questions?** Open an issue or discussion on GitHub.
