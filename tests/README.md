# Video Calling App Test Suite

This directory contains comprehensive tests for the video calling application. The test suite covers all major functionality including models, views, forms, services, WebSocket consumers, integration flows, and edge cases.

## Test Structure

```
tests/
├── __init__.py              # Test package initialization
├── conftest.py              # Pytest configuration and fixtures
├── test_utils.py            # Test utilities and base classes
├── test_models.py           # Model tests
├── test_views.py            # View and API tests
├── test_forms.py            # Form validation tests
├── test_services.py         # Service layer tests
├── test_consumers.py        # WebSocket consumer tests
├── test_integration.py      # End-to-end integration tests
├── test_edge_cases.py       # Edge cases and error handling
└── README.md               # This file
```

## Test Coverage

### 1. Model Tests (`test_models.py`)
- **CustomUser**: User creation, validation, relationships
- **CallSession**: Call lifecycle, status transitions, constraints
- **CallParticipant**: Participant management, uniqueness constraints
- **CallQualityMetrics**: Quality tracking, extreme values
- **Message**: Messaging functionality, file attachments
- **FileUpload**: File upload tracking, status management
- **ProcessedMedia**: Media processing workflow
- **QualityProfile**: User quality preferences

### 2. View Tests (`test_views.py`)
- **Account Views**: Registration, login, dashboard, profile
- **Call Views**: Call creation, joining, room access
- **API Views**: WebRTC JS serving, quality metrics, call status
- **Authentication**: Permission checks, redirects
- **Error Handling**: 404s, invalid inputs, malformed requests

### 3. Form Tests (`test_forms.py`)
- **CustomUserCreationForm**: Validation, error handling
- Password strength validation
- Email validation (optional field)
- Username uniqueness and constraints
- Bootstrap CSS class application

### 4. Service Tests (`test_services.py`)
- **QualityAdaptationService**: Quality optimization algorithms
- **CallService**: Active call caching and retrieval
- Network condition adaptation
- Cache operations and performance

### 5. Consumer Tests (`test_consumers.py`)
- **CallConsumer**: WebSocket message handling
- WebRTC signaling (offers, answers, ICE candidates)
- User join/leave notifications
- Quality changes and screen sharing
- Error handling and message filtering

### 6. Integration Tests (`test_integration.py`)
- Complete user registration flow
- End-to-end call creation and joining
- Messaging workflows
- File upload and processing
- Quality settings management
- Multi-user scenarios

### 7. Edge Cases (`test_edge_cases.py`)
- Database constraints and cascade deletes
- Concurrent operations and race conditions
- Boundary value testing
- Unicode and special character handling
- Security testing (SQL injection, XSS, unauthorized access)
- Performance with large datasets
- Network error simulation

## Running Tests

### Prerequisites
```bash
# Install dependencies
pip install -r requirements.txt
pip install pytest pytest-django

# Set up environment
export DJANGO_SETTINGS_MODULE=config.settings.base
```

### Run All Tests
```bash
# Using Django's test runner
python manage.py test tests

# Using pytest (recommended)
pytest tests/

# With coverage
pytest tests/ --cov=apps --cov-report=html
```

### Run Specific Test Categories
```bash
# Model tests only
python manage.py test tests.test_models

# View tests only
python manage.py test tests.test_views

# Integration tests only
python manage.py test tests.test_integration

# Edge cases only
python manage.py test tests.test_edge_cases
```

### Run Specific Test Classes
```bash
# Specific test class
python manage.py test tests.test_models.CustomUserModelTest

# Specific test method
python manage.py test tests.test_views.AccountViewsTest.test_register_view_post_valid
```

### Performance Tests
```bash
# Run performance-related tests
python manage.py test tests.test_edge_cases.PerformanceEdgeCasesTest

# Run with profiling
python -m cProfile -s cumulative manage.py test tests.test_edge_cases.PerformanceEdgeCasesTest
```

## Test Configuration

### Database
Tests use an in-memory SQLite database for speed. For more realistic testing, you can configure a test-specific database in your settings.

### Cache
Tests automatically clear the cache before and after each test to ensure isolation.

### Media Files
File upload tests use Django's `SimpleUploadedFile` for creating test files without actual file I/O.

## Writing New Tests

### Test Naming Convention
- Test files: `test_*.py`
- Test classes: `*Test` (e.g., `UserModelTest`)
- Test methods: `test_*` (e.g., `test_user_creation`)

### Using Base Classes
```python
from tests.test_utils import BaseTestCase

class MyFeatureTest(BaseTestCase):
    def test_my_feature(self):
        # Use self.user1, self.user2, self.user3 from BaseTestCase
        # Use helper methods like self.create_call_session()
        pass
```

### Test Mixins
Use provided mixins for specific functionality:
- `WebRTCTestMixin`: WebRTC message creation helpers
- `QualityTestMixin`: Quality testing utilities

### Mock Usage
```python
from unittest.mock import patch, MagicMock

@patch('apps.calls.services.cache.get')
def test_with_mocked_cache(self, mock_cache_get):
    mock_cache_get.return_value = None
    # Test code here
```

## Common Test Patterns

### Testing Views
```python
def test_protected_view(self):
    self.client.force_login(self.user1)
    response = self.client.get(reverse('view_name'))
    self.assertEqual(response.status_code, 200)
```

### Testing API Endpoints
```python
def test_api_endpoint(self):
    self.client.force_login(self.user1)
    data = {'key': 'value'}
    response = self.client.post(
        reverse('api_endpoint'),
        data=json.dumps(data),
        content_type='application/json'
    )
    self.assertEqual(response.status_code, 200)
```

### Testing WebSocket Consumers
```python
async def test_consumer_message(self):
    consumer = CallConsumer()
    consumer.scope = {'user': self.user1}
    consumer.channel_layer = AsyncMock()
    
    await consumer.receive(text_data=json.dumps(message_data))
    consumer.channel_layer.group_send.assert_called_once()
```

## Test Data Management

### Fixtures
Use the provided fixtures in `conftest.py`:
- `sample_users`: Pre-created test users
- `sample_call_session`: Sample call with participants
- `api_client`: Django test client

### Factory Methods
Use factory methods from `BaseTestCase`:
- `create_test_user()`
- `create_call_session()`
- `create_call_participant()`
- `create_quality_metrics()`
- `create_message()`
- `create_file_upload()`

## Performance Considerations

### Test Speed
- Use `TestCase` for isolated tests
- Use `TransactionTestCase` only when testing transactions
- Mock external services and slow operations
- Use in-memory database for most tests

### Memory Usage
- Clear large objects after tests
- Use `setUp()` and `tearDown()` properly
- Avoid creating unnecessary test data

## Debugging Tests

### Running Single Tests
```bash
python manage.py test tests.test_models.CustomUserModelTest.test_user_creation -v 2
```

### Debug Output
```python
import pdb; pdb.set_trace()  # Add breakpoint
```

### Logging
```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

## Continuous Integration

These tests are designed to run in CI environments. Make sure to:
1. Set appropriate environment variables
2. Use a test database
3. Install all dependencies
4. Clear caches between test runs

## Contributing

When adding new functionality:
1. Write tests first (TDD approach)
2. Ensure >90% code coverage
3. Test both happy path and edge cases
4. Update this README if adding new test categories
5. Run the full test suite before submitting changes

## Troubleshooting

### Common Issues

1. **Database locks**: Use separate test databases
2. **Cache pollution**: Tests clear cache automatically
3. **Media files**: Use `SimpleUploadedFile` for testing
4. **Async tests**: Use `pytest-asyncio` for async test support
5. **WebSocket tests**: Mock channel layers properly

### Performance Issues
If tests are slow:
1. Check for N+1 queries
2. Use `select_related()` and `prefetch_related()`
3. Mock external API calls
4. Reduce test data size

### Memory Issues
If tests consume too much memory:
1. Clear large objects in `tearDown()`
2. Use smaller test datasets
3. Mock file operations
4. Run tests in smaller batches