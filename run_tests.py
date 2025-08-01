#!/usr/bin/env python
"""
Test runner script for video calling app
Provides convenient commands for running different types of tests
"""
import os
import sys
import subprocess
import argparse
from pathlib import Path

# Add the project root to Python path
PROJECT_ROOT = Path(__file__).parent
sys.path.insert(0, str(PROJECT_ROOT))

# Set Django settings
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.base')

def run_command(command, description):
    """Run a command and handle errors"""
    print(f"\n{'='*60}")
    print(f"Running: {description}")
    print(f"Command: {' '.join(command)}")
    print('='*60)
    
    try:
        result = subprocess.run(command, check=True, capture_output=False)
        print(f"✅ {description} completed successfully!")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ {description} failed with exit code {e.returncode}")
        return False
    except FileNotFoundError:
        print(f"❌ Command not found: {command[0]}")
        print("Make sure the required dependencies are installed.")
        return False

def run_django_tests(test_path=None, verbosity=2):
    """Run Django tests"""
    command = ['python', 'manage.py', 'test']
    if test_path:
        command.append(test_path)
    command.extend(['-v', str(verbosity)])
    
    description = f"Django tests{f' for {test_path}' if test_path else ''}"
    return run_command(command, description)

def run_pytest(test_path=None, options=None):
    """Run pytest"""
    command = ['pytest']
    if test_path:
        command.append(test_path)
    if options:
        command.extend(options)
    
    description = f"Pytest{f' for {test_path}' if test_path else ''}"
    return run_command(command, description)

def run_coverage():
    """Run tests with coverage"""
    command = ['pytest', 'tests/', '--cov=apps', '--cov-report=html', '--cov-report=term']
    return run_command(command, "Coverage analysis")

def run_performance_tests():
    """Run performance tests"""
    command = ['python', 'manage.py', 'test', 'tests.test_edge_cases.PerformanceEdgeCasesTest', '-v', '2']
    return run_command(command, "Performance tests")

def run_security_tests():
    """Run security-related tests"""
    command = ['python', 'manage.py', 'test', 'tests.test_edge_cases.SecurityEdgeCasesTest', '-v', '2']
    return run_command(command, "Security tests")

def run_integration_tests():
    """Run integration tests"""
    command = ['python', 'manage.py', 'test', 'tests.test_integration', '-v', '2']
    return run_command(command, "Integration tests")

def run_unit_tests():
    """Run unit tests (everything except integration)"""
    test_modules = [
        'tests.test_models',
        'tests.test_views',
        'tests.test_forms',
        'tests.test_services',
        'tests.test_consumers',
    ]
    
    success = True
    for module in test_modules:
        result = run_django_tests(module, verbosity=1)
        success = success and result
    
    return success

def run_quick_tests():
    """Run a quick subset of tests for rapid feedback"""
    quick_tests = [
        'tests.test_models.CustomUserModelTest',
        'tests.test_views.AccountViewsTest.test_register_view_get',
        'tests.test_forms.CustomUserCreationFormTest.test_valid_form_creation',
        'tests.test_services.QualityAdaptationServiceTest.test_get_optimal_quality_medium_conditions',
    ]
    
    success = True
    for test in quick_tests:
        result = run_django_tests(test, verbosity=1)
        success = success and result
    
    return success

def check_test_dependencies():
    """Check if test dependencies are installed"""
    print("Checking test dependencies...")
    
    dependencies = [
        ('django', 'Django framework'),
        ('pytest', 'Pytest testing framework'),
        ('coverage', 'Coverage analysis (optional)'),
    ]
    
    missing = []
    for module, description in dependencies:
        try:
            __import__(module)
            print(f"✅ {description}")
        except ImportError:
            if module == 'coverage':
                print(f"⚠️  {description} (optional, install with: pip install coverage)")
            else:
                print(f"❌ {description}")
                missing.append(module)
    
    if missing:
        print(f"\nMissing required dependencies: {', '.join(missing)}")
        print("Install them with: pip install " + " ".join(missing))
        return False
    
    return True

def main():
    parser = argparse.ArgumentParser(description='Test runner for video calling app')
    parser.add_argument('action', nargs='?', default='all',
                       choices=['all', 'unit', 'integration', 'quick', 'coverage', 
                               'performance', 'security', 'models', 'views', 'forms', 
                               'services', 'consumers', 'edge-cases', 'check-deps'],
                       help='Type of tests to run')
    parser.add_argument('--path', help='Specific test path to run')
    parser.add_argument('--django', action='store_true', help='Use Django test runner instead of pytest')
    parser.add_argument('--verbose', '-v', type=int, default=2, help='Verbosity level (1-3)')
    
    args = parser.parse_args()
    
    # Check dependencies first
    if not check_test_dependencies():
        return 1
    
    success = True
    
    if args.action == 'check-deps':
        return 0  # Already checked above
    elif args.action == 'all':
        if args.django:
            success = run_django_tests('tests', args.verbose)
        else:
            success = run_pytest('tests/')
    elif args.action == 'unit':
        success = run_unit_tests()
    elif args.action == 'integration':
        success = run_integration_tests()
    elif args.action == 'quick':
        success = run_quick_tests()
    elif args.action == 'coverage':
        success = run_coverage()
    elif args.action == 'performance':
        success = run_performance_tests()
    elif args.action == 'security':
        success = run_security_tests()
    elif args.action in ['models', 'views', 'forms', 'services', 'consumers', 'edge-cases']:
        test_path = f"tests.test_{args.action.replace('-', '_')}"
        success = run_django_tests(test_path, args.verbose)
    elif args.path:
        if args.django:
            success = run_django_tests(args.path, args.verbose)
        else:
            success = run_pytest(args.path)
    
    if success:
        print(f"\n🎉 All tests passed!")
        return 0
    else:
        print(f"\n💥 Some tests failed!")
        return 1

if __name__ == '__main__':
    sys.exit(main())