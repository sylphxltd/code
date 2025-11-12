/**
 * Selection Mode Handler
 *
 * Handles keyboard input when in selection mode (waitForInput with type: selection).
 * Migrated from useSelectionMode hook with full feature parity.
 *
 * Features:
 * - Single/multi-question support
 * - Single/multi-select options
 * - Filter mode (/ to filter options)
 * - Free text mode (custom input option)
 * - Tab navigation between questions
 * - Auto-submit when all answered
 */

import type { Key } from "ink";
import type React from "react";
import type { WaitForInputOptions } from "../../../commands/types.js";
import { InputMode, type InputModeContext } from "../types.js";
import { BaseInputHandler } from "./BaseHandler.js";

export interface SelectionModeHandlerDeps {
	// Core state
	inputResolver: React.MutableRefObject<
		((value: string | Record<string, string | string[]>) => void) | null
	>;
	multiSelectionPage: number;
	multiSelectionAnswers: Record<string, string | string[]>;
	multiSelectChoices: Set<string>;
	selectionFilter: string;
	isFilterMode: boolean;
	freeTextInput: string;
	isFreeTextMode: boolean;
	selectedCommandIndex: number;
	commandSessionRef: React.MutableRefObject<string | null>;
	currentSessionId: string | null;

	// Setters
	setSelectedCommandIndex: React.Dispatch<React.SetStateAction<number>>;
	setMultiSelectionPage: React.Dispatch<React.SetStateAction<number>>;
	setMultiSelectionAnswers: React.Dispatch<React.SetStateAction<Record<string, string | string[]>>>;
	setMultiSelectChoices: React.Dispatch<React.SetStateAction<Set<string>>>;
	setSelectionFilter: React.Dispatch<React.SetStateAction<string>>;
	setIsFilterMode: (value: boolean) => void;
	setFreeTextInput: React.Dispatch<React.SetStateAction<string>>;
	setIsFreeTextMode: (value: boolean) => void;
	setPendingInput: (value: WaitForInputOptions | null) => void;

	// Actions
	addLog: (message: string) => void;
	addMessage: (params: any) => Promise<string>;
	getAIConfig: () => { defaultProvider?: string; defaultModel?: string } | null;
}

/**
 * Handler for selection mode input
 * Complete implementation migrated from useSelectionMode hook
 */
export class SelectionModeHandler extends BaseInputHandler {
	mode = InputMode.SELECTION;
	priority = 10; // High priority - explicit user interaction mode

	constructor(private deps: SelectionModeHandlerDeps) {
		super();
	}

	async handleInput(char: string, key: Key, context: InputModeContext): Promise<boolean> {
		const { pendingInput } = context;

		// Guard: Only handle when in selection mode with valid pendingInput
		if (!pendingInput || pendingInput.type !== "selection" || !this.deps.inputResolver.current) {
			return false;
		}

		const {
			selectedCommandIndex,
			multiSelectionPage,
			multiSelectionAnswers,
			multiSelectChoices,
			selectionFilter,
			isFilterMode,
			freeTextInput,
			isFreeTextMode,
			setSelectedCommandIndex,
			setMultiSelectionPage,
			setMultiSelectionAnswers,
			setMultiSelectChoices,
			setSelectionFilter,
			setIsFilterMode,
			setFreeTextInput,
			setIsFreeTextMode,
			setPendingInput,
			addLog,
			addMessage,
			getAIConfig,
			commandSessionRef,
			currentSessionId,
			inputResolver,
		} = this.deps;

		const questions = pendingInput.questions;
		const isSingleQuestion = questions.length === 1;
		const currentQuestion = questions[multiSelectionPage];
		const totalQuestions = questions.length;

		// Guard: Ensure current question exists
		if (!currentQuestion) {
			return false;
		}

		// Calculate filtered options for navigation
		const filteredOptions = currentQuestion.options.filter(
			(option) =>
				option.label.toLowerCase().includes(selectionFilter.toLowerCase()) ||
				(option.value && option.value.toLowerCase().includes(selectionFilter.toLowerCase())),
		);
		const maxIndex = filteredOptions.length - 1;

		// ========================================================================
		// Arrow Navigation (works in all sub-modes)
		// ========================================================================

		if (key.downArrow) {
			return this.handleArrowDown(() => {
				setSelectedCommandIndex((prev) => (prev < maxIndex ? prev + 1 : prev));
			});
		}

		if (key.upArrow) {
			return this.handleArrowUp(() => {
				setSelectedCommandIndex((prev) => (prev > 0 ? prev - 1 : 0));
			});
		}

		// ========================================================================
		// Escape Key Handling
		// ========================================================================

		if (key.escape) {
			if (isFreeTextMode) {
				// Exit free text mode without saving
				setIsFreeTextMode(false);
				setFreeTextInput("");
				addLog("[freetext] Cancelled free text input");
				return true;
			} else if (isFilterMode) {
				// Exit filter mode but keep filter text
				setIsFilterMode(false);
				addLog("[filter] Exited filter mode, filter text preserved");
				return true;
			} else if (selectionFilter.length > 0) {
				// Clear filter text
				setSelectionFilter("");
				setSelectedCommandIndex(0);
				addLog("[filter] Cleared filter text");
				return true;
			} else {
				// Cancel entire selection
				addLog(`[selection] Cancelled`);
				inputResolver.current({});
				inputResolver.current = null;
				setPendingInput(null);
				setMultiSelectionPage(0);
				setMultiSelectionAnswers({});
				setMultiSelectChoices(new Set());
				setSelectionFilter("");
				setIsFilterMode(false);
				return true;
			}
		}

		// ========================================================================
		// Free Text Mode
		// ========================================================================

		if (isFreeTextMode) {
			// Enter - submit free text
			if (key.return) {
				const selectedOption = filteredOptions[selectedCommandIndex];
				if (!selectedOption || !freeTextInput.trim()) {
					addLog("[freetext] Cannot submit empty free text");
					return true;
				}

				const customValue = freeTextInput.trim();
				addLog(`[freetext] Submitted: ${customValue}`);

				// Add user's answer to chat history
				const aiConfig = getAIConfig();
				const provider = aiConfig?.defaultProvider || "openrouter";
				const model = aiConfig?.defaultModel || "anthropic/claude-3.5-sonnet";

				const sessionIdToUse = commandSessionRef.current || currentSessionId;
				const resultSessionId = await addMessage({
					sessionId: sessionIdToUse,
					role: "user",
					content: customValue,
					provider,
					model,
				});

				if (!commandSessionRef.current) {
					commandSessionRef.current = resultSessionId;
				}

				if (isSingleQuestion) {
					// Single question: submit immediately
					inputResolver.current({ [currentQuestion.id]: customValue });
					inputResolver.current = null;
					setPendingInput(null);
					setMultiSelectionPage(0);
					setMultiSelectionAnswers({});
					setIsFreeTextMode(false);
					setFreeTextInput("");
					setSelectionFilter("");
					setIsFilterMode(false);
				} else {
					// Multi-question: save answer and move to next
					const newAnswers = {
						...multiSelectionAnswers,
						[currentQuestion.id]: customValue,
					};
					setMultiSelectionAnswers(newAnswers);
					setIsFreeTextMode(false);
					setFreeTextInput("");

					// Check if all questions are answered
					const allAnswered = questions.every((q) => newAnswers[q.id]);

					if (allAnswered) {
						// All answered: auto-submit
						addLog(`[selection] All answered, auto-submitting: ${JSON.stringify(newAnswers)}`);
						inputResolver.current(newAnswers);
						inputResolver.current = null;
						setPendingInput(null);
						setMultiSelectionPage(0);
						setMultiSelectionAnswers({});
						setSelectionFilter("");
						setIsFilterMode(false);
					} else {
						// Move to next unanswered question
						const nextUnanswered = questions.findIndex(
							(q, idx) => idx > multiSelectionPage && !newAnswers[q.id],
						);
						if (nextUnanswered !== -1) {
							setMultiSelectionPage(nextUnanswered);
						}
						setSelectedCommandIndex(0);
						setSelectionFilter("");
					}
				}
				return true;
			}

			// Backspace - delete character
			if (key.backspace || key.delete) {
				setFreeTextInput((prev) => prev.slice(0, -1));
				return true;
			}

			// Character - add to input
			if (char && !key.ctrl) {
				setFreeTextInput((prev) => prev + char);
				return true;
			}
			return true;
		}

		// ========================================================================
		// Filter Mode
		// ========================================================================

		// "/" - Enter filter mode
		if (char === "/" && !isFilterMode) {
			setIsFilterMode(true);
			addLog("[filter] Entered filter mode (press / to filter)");
			return true;
		}

		// Handle text input for filtering (only when in filter mode)
		if (char && !key.return && !key.escape && !key.tab && !key.ctrl && isFilterMode) {
			setSelectionFilter((prev) => prev + char);
			setSelectedCommandIndex(0);
			return true;
		}

		// Handle backspace for filtering
		if (key.backspace || key.delete) {
			if (selectionFilter.length > 0) {
				setSelectionFilter((prev) => prev.slice(0, -1));
				// Exit filter mode if filter becomes empty
				if (selectionFilter.length === 1) {
					setIsFilterMode(false);
				}
				setSelectedCommandIndex(0);
				return true;
			}
			// Let event propagate to text input when filter is empty
		}

		// ========================================================================
		// Multi-Question Navigation (Tab)
		// ========================================================================

		if (!isSingleQuestion) {
			// Tab - Next question
			if (key.tab && !key.shift) {
				setMultiSelectionPage((prev) => (prev + 1) % totalQuestions);
				setSelectedCommandIndex(0);
				setSelectionFilter("");
				setIsFilterMode(false);

				// Restore choices for the new question if it's multi-select
				const nextPage = (multiSelectionPage + 1) % totalQuestions;
				const nextQuestion = questions[nextPage];
				if (nextQuestion && nextQuestion.multiSelect) {
					this.restoreMultiSelectChoices(nextQuestion, multiSelectionAnswers, setMultiSelectChoices);
				} else {
					setMultiSelectChoices(new Set());
				}
				return true;
			}

			// Shift+Tab - Previous question
			if (key.shift && key.tab) {
				setMultiSelectionPage((prev) => (prev - 1 + totalQuestions) % totalQuestions);
				setSelectedCommandIndex(0);
				setSelectionFilter("");
				setIsFilterMode(false);

				// Restore choices for the new question if it's multi-select
				const prevPage = (multiSelectionPage - 1 + totalQuestions) % totalQuestions;
				const prevQuestion = questions[prevPage];
				if (prevQuestion && prevQuestion.multiSelect) {
					this.restoreMultiSelectChoices(prevQuestion, multiSelectionAnswers, setMultiSelectChoices);
				} else {
					setMultiSelectChoices(new Set());
				}
				return true;
			}
		}

		// ========================================================================
		// Ctrl+Enter - Submit All Answers (multi-question only)
		// ========================================================================

		if (!isSingleQuestion && key.ctrl && key.return) {
			const allAnswered = questions.every((q) => multiSelectionAnswers[q.id]);
			if (allAnswered) {
				addLog(`[selection] Submitting answers: ${JSON.stringify(multiSelectionAnswers)}`);
				inputResolver.current(multiSelectionAnswers);
				inputResolver.current = null;
				setPendingInput(null);
				setMultiSelectionPage(0);
				setMultiSelectionAnswers({});
				setMultiSelectChoices(new Set());
				setSelectionFilter("");
				setIsFilterMode(false);
			} else {
				addLog(`[selection] Cannot submit: not all questions answered`);
			}
			return true;
		}

		// ========================================================================
		// Space - Toggle Multi-Select Choice
		// ========================================================================

		if (char === " ") {
			addLog(
				`[multi-select] Space pressed - multiSelect: ${currentQuestion?.multiSelect}, isFilterMode: ${isFilterMode}, selectedCommandIndex: ${selectedCommandIndex}, filteredOptionsCount: ${filteredOptions.length}`,
			);

			if (currentQuestion?.multiSelect && !isFilterMode) {
				const selectedOption = filteredOptions[selectedCommandIndex];
				if (selectedOption) {
					const selectedValue = selectedOption.value || selectedOption.label;
					setMultiSelectChoices((prev) => {
						const newChoices = new Set(prev);
						if (newChoices.has(selectedValue)) {
							newChoices.delete(selectedValue);
							addLog(`[multi-select] Unchecked: ${selectedValue}`);
						} else {
							newChoices.add(selectedValue);
							addLog(`[multi-select] Checked: ${selectedValue}`);
						}
						return newChoices;
					});
				} else {
					addLog(`[multi-select] No selected option at index ${selectedCommandIndex}`);
				}
				return true;
			} else {
				addLog(`[multi-select] Space not handled - conditions not met`);
			}
		}

		// ========================================================================
		// Enter - Select Option / Confirm Multi-Select / Enter Free Text Mode
		// ========================================================================

		if (key.return) {
			const selectedOption = filteredOptions[selectedCommandIndex];

			// Check if selected option is a free text option
			if (selectedOption?.freeText) {
				setIsFreeTextMode(true);
				setFreeTextInput("");
				addLog("[freetext] Entered free text mode");
				return true;
			}

			// Multi-select mode: confirm current choices
			if (currentQuestion?.multiSelect) {
				if (multiSelectChoices.size === 0) {
					addLog(`[multi-select] No choices selected, skipping`);
					return true;
				}

				const choicesArray = Array.from(multiSelectChoices);
				addLog(`[multi-select] Q${multiSelectionPage + 1}: ${choicesArray.join(", ")}`);

				await this.submitAnswer(
					currentQuestion,
					choicesArray,
					isSingleQuestion,
					questions,
					multiSelectionPage,
					multiSelectionAnswers,
					{
						inputResolver,
						setPendingInput,
						setMultiSelectionPage,
						setMultiSelectionAnswers,
						setMultiSelectChoices,
						setSelectionFilter,
						setIsFilterMode,
						setSelectedCommandIndex,
						addLog,
						addMessage,
						getAIConfig,
						commandSessionRef,
						currentSessionId,
					},
				);
			} else {
				// Single-select mode: select one option
				if (selectedOption) {
					const selectedValue = selectedOption.value || selectedOption.label;
					addLog(`[selection] Q${multiSelectionPage + 1}: ${selectedValue}`);

					await this.submitAnswer(
						currentQuestion,
						selectedValue,
						isSingleQuestion,
						questions,
						multiSelectionPage,
						multiSelectionAnswers,
						{
							inputResolver,
							setPendingInput,
							setMultiSelectionPage,
							setMultiSelectionAnswers,
							setMultiSelectChoices,
							setSelectionFilter,
							setIsFilterMode,
							setSelectedCommandIndex,
							addLog,
							addMessage,
							getAIConfig,
							commandSessionRef,
							currentSessionId,
						},
					);
				}
			}
			return true;
		}

		return false; // Not handled
	}

	/**
	 * Helper: Restore multi-select choices when navigating between questions
	 */
	private restoreMultiSelectChoices(
		question: any,
		multiSelectionAnswers: Record<string, string | string[]>,
		setMultiSelectChoices: React.Dispatch<React.SetStateAction<Set<string>>>,
	): void {
		// If question was already answered, restore the answer
		if (multiSelectionAnswers[question.id]) {
			const savedAnswer = multiSelectionAnswers[question.id];
			setMultiSelectChoices(new Set(Array.isArray(savedAnswer) ? savedAnswer : []));
		} else {
			// Priority 1: option.checked
			const checkedOptions = question.options
				.filter((opt: any) => opt.checked)
				.map((opt: any) => opt.value || opt.label);

			if (checkedOptions.length > 0) {
				setMultiSelectChoices(new Set(checkedOptions));
			}
			// Priority 2: question.preSelected
			else if (question.preSelected) {
				setMultiSelectChoices(new Set(question.preSelected));
			} else {
				setMultiSelectChoices(new Set());
			}
		}
	}

	/**
	 * Helper: Submit an answer and handle state transitions
	 */
	private async submitAnswer(
		currentQuestion: any,
		answer: string | string[],
		isSingleQuestion: boolean,
		questions: any[],
		multiSelectionPage: number,
		multiSelectionAnswers: Record<string, string | string[]>,
		deps: {
			inputResolver: React.MutableRefObject<
				((value: string | Record<string, string | string[]>) => void) | null
			>;
			setPendingInput: (value: WaitForInputOptions | null) => void;
			setMultiSelectionPage: React.Dispatch<React.SetStateAction<number>>;
			setMultiSelectionAnswers: React.Dispatch<
				React.SetStateAction<Record<string, string | string[]>>
			>;
			setMultiSelectChoices: React.Dispatch<React.SetStateAction<Set<string>>>;
			setSelectionFilter: React.Dispatch<React.SetStateAction<string>>;
			setIsFilterMode: (value: boolean) => void;
			setSelectedCommandIndex: React.Dispatch<React.SetStateAction<number>>;
			addLog: (message: string) => void;
			addMessage: (params: any) => Promise<string>;
			getAIConfig: () => { defaultProvider?: string; defaultModel?: string } | null;
			commandSessionRef: React.MutableRefObject<string | null>;
			currentSessionId: string | null;
		},
	): Promise<void> {
		const {
			inputResolver,
			setPendingInput,
			setMultiSelectionPage,
			setMultiSelectionAnswers,
			setMultiSelectChoices,
			setSelectionFilter,
			setIsFilterMode,
			setSelectedCommandIndex,
			addLog,
			addMessage,
			getAIConfig,
			commandSessionRef,
			currentSessionId,
		} = deps;

		// Add user's answer to chat history
		const aiConfig = getAIConfig();
		const provider = aiConfig?.defaultProvider || "openrouter";
		const model = aiConfig?.defaultModel || "anthropic/claude-3.5-sonnet";

		const sessionIdToUse = commandSessionRef.current || currentSessionId;
		const content = Array.isArray(answer) ? answer.join(", ") : answer;
		const resultSessionId = await addMessage({
			sessionId: sessionIdToUse,
			role: "user",
			content: Array.isArray(answer) ? content : (currentQuestion.options.find((opt: any) => (opt.value || opt.label) === answer)?.label || answer),
			provider,
			model,
		});

		if (!commandSessionRef.current) {
			commandSessionRef.current = resultSessionId;
		}

		if (isSingleQuestion) {
			// Single question: submit immediately
			inputResolver.current({ [currentQuestion.id]: answer });
			inputResolver.current = null;
			setPendingInput(null);
			setMultiSelectionPage(0);
			setMultiSelectionAnswers({});
			setMultiSelectChoices(new Set());
			setSelectionFilter("");
			setIsFilterMode(false);
		} else {
			// Multi-question: save answer
			const newAnswers = {
				...multiSelectionAnswers,
				[currentQuestion.id]: answer,
			};
			setMultiSelectionAnswers(newAnswers);
			setMultiSelectChoices(new Set()); // Clear choices for next question

			// Check if all questions are answered
			const allAnswered = questions.every((q) => newAnswers[q.id]);

			if (allAnswered) {
				// All answered: auto-submit
				addLog(`[selection] All answered, auto-submitting: ${JSON.stringify(newAnswers)}`);
				inputResolver.current(newAnswers);
				inputResolver.current = null;
				setPendingInput(null);
				setMultiSelectionPage(0);
				setMultiSelectionAnswers({});
				setSelectionFilter("");
				setIsFilterMode(false);
			} else {
				// Move to next unanswered question
				const nextUnanswered = questions.findIndex(
					(q, idx) => idx > multiSelectionPage && !newAnswers[q.id],
				);
				if (nextUnanswered !== -1) {
					setMultiSelectionPage(nextUnanswered);
				}
				setSelectedCommandIndex(0);
				setSelectionFilter("");
			}
		}
	}

	/**
	 * Additional validation beyond base isActive
	 * Ensures we have all required state for selection mode
	 */
	isActive(context: InputModeContext): boolean {
		if (!super.isActive(context)) {
			return false;
		}

		// Additional checks
		const { pendingInput } = context;
		return !!(
			pendingInput &&
			pendingInput.type === "selection" &&
			this.deps.inputResolver.current
		);
	}
}
