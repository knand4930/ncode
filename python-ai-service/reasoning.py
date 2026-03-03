"""
Advanced AI Reasoning and Issue Detection

Provides robust reasoning capabilities, issue detection, and confidence scoring.
"""

import json
import logging
import re
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# ============================================================================
# DATA STRUCTURES
# ============================================================================

@dataclass
class Issue:
    """Detected issue in code"""
    type: str  # "bug", "performance", "security", "style", "logic"
    severity: str  # "critical", "high", "medium", "low"
    location: str  # file:line
    description: str
    suggested_fix: Optional[str] = None
    confidence: float = 0.8

@dataclass
class ReasoningStep:
    """A step in the reasoning process"""
    phase: str  # "understand", "explore", "evaluate", "decide"
    thought: str
    confidence: float = 0.8

@dataclass
class AnalysisResult:
    """Result of code analysis"""
    summary: str
    issues: List[Issue]
    reasoning_steps: List[ReasoningStep]
    overall_confidence: float = 0.8
    recommendations: List[str] = None

    def __post_init__(self):
        if self.recommendations is None:
            self.recommendations = []

# ============================================================================
# ISSUE DETECTION ENGINE
# ============================================================================

class IssueDetector:
    """Detects code issues using pattern matching and heuristics"""
    
    # Error patterns and severity
    PATTERNS = {
        # Resource leaks
        "resource_leak": {
            "patterns": [
                r"\.open\(.*\)(?!.*\.close\(\))",
                r"connection\s*=.*(?!.*connection\.close)",
            ],
            "severity": "high",
            "type": "resource_leak",
        },
        # Missing error handling
        "unhandled_error": {
            "patterns": [
                r"await\s+\w+\(\)(?!\s*\.catch|\s*except|\s*\?|try)",
                r"\.parse\(.*\)(?!\s*\.catch|\s*except)",
            ],
            "severity": "high",
            "type": "unhandled_error",
        },
        # Unsafe null operations
        "null_safety": {
            "patterns": [
                r"\w+\?\.(?!.*null-coalescing|\s*\|\|)",
                r"unwrap\(\)",
            ],
            "severity": "medium",
            "type": "null_safety",
        },
        # Race conditions
        "race_condition": {
            "patterns": [
                r"async.*\bawait\b.*\bawait\b",
                r"\.then\(.*\.then\(",
            ],
            "severity": "high",
            "type": "race_condition",
        },
    }
    
    @staticmethod
    def detect_issues(code: str, language: str = "unknown") -> List[Issue]:
        """Detect issues in code"""
        issues = []
        
        lines = code.split("\n")
        for pattern_name, pattern_info in IssueDetector.PATTERNS.items():
            for pattern in pattern_info.get("patterns", []):
                for line_no, line in enumerate(lines, 1):
                    if re.search(pattern, line):
                        issue = Issue(
                            type=pattern_info["type"],
                            severity=pattern_info["severity"],
                            location=f":{line_no}",
                            description=f"Potential {pattern_name}: {line.strip()}",
                            confidence=0.6,
                        )
                        issues.append(issue)
        
        return issues
    
    @staticmethod
    def detect_complexity(code: str) -> Tuple[int, str]:
        """Estimate cyclomatic complexity"""
        # Simple heuristic: count control flow statements
        complexity = 1
        keywords = ["if", "else", "case", "for", "while", "catch", "and", "or"]
        
        for keyword in keywords:
            complexity += len(re.findall(rf"\b{keyword}\b", code, re.IGNORECASE))
        
        level = "low"
        if complexity > 10:
            level = "high"
        elif complexity > 5:
            level = "medium"
        
        return complexity, level

# ============================================================================
# REASONING ENGINE
# ============================================================================

class ReasoningEngine:
    """Generates structured reasoning steps"""
    
    @staticmethod
    def generate_understanding_steps(problem: str, context: str) -> List[ReasoningStep]:
        """Generate understanding phase steps"""
        steps = []
        
        # Extract key elements
        if "code" in problem.lower():
            steps.append(ReasoningStep(
                phase="understand",
                thought="This is a code synthesis or analysis task. Focus on correctness and best practices.",
                confidence=0.9
            ))
        
        if "design" in problem.lower() or "architecture" in problem.lower():
            steps.append(ReasoningStep(
                phase="understand",
                thought="This requires systems thinking. Consider scalability and maintainability.",
                confidence=0.9
            ))
        
        if "bug" in problem.lower() or "fix" in problem.lower():
            steps.append(ReasoningStep(
                phase="understand",
                thought="This is a debugging task. Focus on root cause and edge cases.",
                confidence=0.95
            ))
        
        if len(context) > 100:
            steps.append(ReasoningStep(
                phase="understand",
                thought="Rich codebase context available. Use it to provide specific, grounded advice.",
                confidence=0.85
            ))
        
        return steps
    
    @staticmethod
    def generate_exploration_steps(problem: str) -> List[ReasoningStep]:
        """Generate exploration phase steps"""
        steps = []
        
        if "multiple" in problem.lower() or "best" in problem.lower():
            steps.append(ReasoningStep(
                phase="explore",
                thought="Generate at least 2-3 different approaches before evaluation.",
                confidence=0.8
            ))
        
        if "optimize" in problem.lower():
            steps.append(ReasoningStep(
                phase="explore",
                thought="Consider time/space tradeoffs. Benchmark if possible.",
                confidence=0.85
            ))
        
        if "error" in problem.lower() or "exception" in problem.lower():
            steps.append(ReasoningStep(
                phase="explore",
                thought="Explore edge cases and failure modes systematically.",
                confidence=0.9
            ))
        
        return steps
    
    @staticmethod
    def generate_decision_steps(problem: str) -> List[ReasoningStep]:
        """Generate decision phase steps"""
        steps = []
        
        steps.append(ReasoningStep(
            phase="decide",
            thought="Select the approach that balances readability, performance, and maintainability.",
            confidence=0.85
        ))
        
        return steps

# ============================================================================
# CONFIDENCE SCORING
# ============================================================================

class ConfidenceScorer:
    """Scores confidence in AI responses"""
    
    @staticmethod
    def score_response(
        response: str,
        has_code_context: bool = False,
        has_codebase_context: bool = False,
        is_straightforward: bool = False,
    ) -> float:
        """Score confidence in response (0-1)"""
        confidence = 0.5
        
        # Base score
        if is_straightforward:
            confidence += 0.2
        
        # Context boost
        if has_code_context:
            confidence += 0.15
        if has_codebase_context:
            confidence += 0.15
        
        # Response quality
        if len(response) > 500:  # Detailed response
            confidence += 0.1
        
        if any(code_marker in response for code_marker in ["```", "def ", "class ", "async "]):
            confidence += 0.1
        
        # Cap at 0.95 (always some uncertainty)
        return min(0.95, max(0.3, confidence))

    @staticmethod
    def score(response: str, prompt: str = "", issue_count: int = 0) -> float:
        """Backward-compatible scorer used by server.py."""
        prompt_l = (prompt or "").lower()
        has_code_context = any(tok in prompt_l for tok in ("```", "function", "class", "def ", "code"))
        has_codebase_context = any(tok in prompt_l for tok in ("file", "repo", "project", "module", "path"))
        is_straightforward = issue_count == 0 and len(prompt_l) < 240
        return ConfidenceScorer.score_response(
            response=response,
            has_code_context=has_code_context,
            has_codebase_context=has_codebase_context,
            is_straightforward=is_straightforward,
        )

# ============================================================================
# RESPONSE VALIDATION
# ============================================================================

class ResponseValidator:
    """Validates AI responses"""
    
    @staticmethod
    def validate_code_response(response: str) -> Tuple[bool, List[str]]:
        """Validate if code snippet is valid"""
        issues = []
        
        if "```" in response:
            # Has code blocks - good
            pass
        else:
            issues.append("No code examples provided")
        
        # Check for explanation
        if len(response) < 200:
            issues.append("Response too brief - may lack detail")
        
        # Check for common issues
        if response.lower().count("sorry") > 2 or "cannot access" in response.lower():
            issues.append("Response appears to be deflecting - may not be grounded in context")
        
        is_valid = len(issues) == 0
        return is_valid, issues
    
    @staticmethod
    def validate_analysis_response(response: str) -> Tuple[bool, List[str]]:
        """Validate analysis response"""
        issues = []
        
        if not any(marker in response for marker in ["issue", "problem", "found", "error"]):
            issues.append("No issues identified - analysis may be incomplete")
        
        if "```" in response:
            pass
        else:
            # No code examples - might be shallow
            if "code" in response.lower() or "example" in response.lower():
                issues.append("Mentions code but no examples shown")
        
        is_valid = len(issues) < 2
        return is_valid, issues

    @staticmethod
    def validate_response(response: str, is_code_focused: bool = False) -> bool:
        """Backward-compatible validator used by server.py."""
        if is_code_focused:
            valid, _ = ResponseValidator.validate_code_response(response)
        else:
            valid, _ = ResponseValidator.validate_analysis_response(response)
        return valid

# ============================================================================
# STREAMING RESPONSE BUILDER
# ============================================================================

class StreamingResponseBuilder:
    """Builds responses from streaming tokens intelligently"""
    
    def __init__(self, max_reasoning_tokens: int = 2000):
        self.reasoning_buffer = []
        self.response_buffer = []
        self.max_reasoning_tokens = max_reasoning_tokens
        self.in_reasoning = False
        self.in_code_block = False
    
    def add_token(self, token: str) -> Optional[str]:
        """Process token, return displayable content"""
        # Track code blocks
        if "```" in token:
            self.in_code_block = not self.in_code_block
        
        # Track reasoning blocks (for extended thinking)
        if "<thinking>" in token:
            self.in_reasoning = True
        if "</thinking>" in token:
            self.in_reasoning = False
        
        # Store reasoning but don't display unless enabled
        if self.in_reasoning:
            self.reasoning_buffer.append(token)
            # Limit reasoning
            if len("".join(self.reasoning_buffer)) > self.max_reasoning_tokens:
                return None  # Truncate reasoning
            return None  # Don't display reasoning (unless in debug mode)
        
        # Regular response
        self.response_buffer.append(token)
        return token
    
    def get_summary(self) -> Dict[str, str]:
        """Get complete response with reasoning"""
        return {
            "response": "".join(self.response_buffer),
            "reasoning": "".join(self.reasoning_buffer),
        }

# ============================================================================
# ERROR RECOVERY
# ============================================================================

class ErrorRecoverer:
    """Handles and recovers from errors"""
    
    @staticmethod
    def should_retry(error: str) -> bool:
        """Determine if request should be retried"""
        transient_errors = [
            "timeout",
            "temporarily unavailable",
            "rate limit",
            "connection refused",
        ]
        return any(err in error.lower() for err in transient_errors)
    
    @staticmethod
    def get_fallback_response(error: str, user_query: str) -> str:
        """Provide fallback response when AI service fails"""
        if "timeout" in error.lower():
            return f"The AI service is taking longer than expected. Try:\n1. Breaking down '{user_query}' into smaller parts\n2. Providing more specific context\n3. Trying again in a moment"
        
        elif "rate limit" in error.lower():
            return "Rate limit reached. Please wait a moment before trying again."
        
        elif "not available" in error.lower():
            return "The selected AI model is not available. Please check your configuration or select a different model."
        
        else:
            return f"AI service encountered an issue: {error[:100]}. Please try again or check your settings."

# ============================================================================
# QUALITY METRICS
# ============================================================================

class QualityMetrics:
    """Calculates quality metrics for responses"""
    
    @staticmethod
    def calculate_metrics(
        response: str,
        has_codebase_context: bool,
        reasoning_steps: List[ReasoningStep],
    ) -> Dict[str, float]:
        """Calculate quality metrics (0-1 scale)"""
        metrics = {}
        
        # Depth score
        metrics["depth"] = min(1.0, len(response) / 1000.0)
        
        # Evidence score
        evidence_markers = ["file:", "line ", "function", "class", "example"]
        evidence_count = sum(1 for marker in evidence_markers if marker in response.lower())
        metrics["evidence"] = min(1.0, evidence_count / 5.0)
        
        # Reasoning score
        metrics["reasoning"] = min(1.0, len(reasoning_steps) / 10.0)
        
        # Context utilization
        if has_codebase_context:
            metrics["context_usage"] = 1.0 if "file" in response.lower() else 0.5
        else:
            metrics["context_usage"] = 0.5
        
        # Overall quality
        metrics["overall"] = sum(metrics.values()) / len(metrics)
        
        return metrics
