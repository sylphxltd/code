/**
 * Selection Mode Hook
 * Handles selection mode for command waitForInput (questions/options)
 *
 * Single Responsibility: Selection mode navigation and interaction
 * Includes: filter mode, free text mode, multi-select, multi-question
 */

import { useInput } from "ink";
import { useEffect, useRef } from "react";
import type React from "react";
import type { WaitForInputOptions } from "../../commands/types.js";

export interface UseSelectionModeOptions {
	pendingInput: WaitForInputOptions | null;
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
	setSelectedCommandIndex: React.Dispatch<React.SetStateAction<number>>;
	setMultiSelectionPage: React.Dispatch<React.SetStateAction<number>>;
	setMultiSelectionAnswers: React.Dispatch<React.SetStateAction<Record<string, string | string[]>>>;
	setMultiSelectChoices: React.Dispatch<React.SetStateAction<Set<string>>>;
	setSelectionFilter: React.Dispatch<React.SetStateAction<string>>;
	setIsFilterMode: (value: boolean) => void;
	setFreeTextInput: React.Dispatch<React.SetStateAction<string>>;
	setIsFreeTextMode: (value: boolean) => void;
	setPendingInput: (value: WaitForInputOptions | null) => void;
	addLog: (message: string) => void;
	addMessage: (params: any) => Promise<string>;
	getAIConfig: () => { defaultProvider?: string; defaultModel?: string } | null;
}

/**
 * Handles selection mode when command calls waitForInput({ type: 'selection' })
 * Features:
 * - Single/multi-question support
 * - Single/multi-select options
 * - Filter mode (/ to filter options)
 * - Free text mode (custom input option)
 * - Tab navigation between questions
 * - Auto-submit when all answered
 */
export function useSelectionMode(options: UseSelectionModeOptions) {
	const {
		pendingInput,
		inputResolver,
		multiSelectionPage,
		multiSelectionAnswers,
		multiSelectChoices,
		selectionFilter,
		isFilterMode,
		freeTextInput,
		isFreeTextMode,
		selectedCommandIndex,
		commandSessionRef,
		currentSessionId,
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
	} = options;

	// Track initialized questions to avoid re-initialization
	const initializedQuestionsRef = useRef<Set<string>>(new Set());

	// Initialize multiSelectChoices when pendingInput first appears with multi-select question
	// This ensures preSelected items are checked by default
	useEffect(() => {
		if (!pendingInput || pendingInput.type !== "selection") {
			return;
		}

		const currentQuestion = pendingInput.questions[multiSelectionPage];
		if (!currentQuestion?.multiSelect) {
			return;
		}

		// Check if already initialized this question
		const questionKey = `${multiSelectionPage}-${currentQuestion.id}`;
		if (initializedQuestionsRef.current.has(questionKey)) {
			return;
		}

		// Only initialize if there's a preSelected array
		const preSelected = currentQuestion.preSelected;
		if (!preSelected || preSelected.length === 0) {
			return;
		}

		// Mark as initialized and set choices
		initializedQuestionsRef.current.add(questionKey);
		setMultiSelectChoices(new Set(preSelected));
	}, [pendingInput, multiSelectionPage, setMultiSelectChoices]);

	useInput(
		async (char, key) => {
			// Only handle when pendingInput is selection mode
			if (!pendingInput || pendingInput.type !== "selection" || !inputResolver.current) {
				return false;
			}

			const questions = pendingInput.questions;
			const isSingleQuestion = questions.length === 1;
			const currentQuestion = questions[multiSelectionPage];
			const totalQuestions = questions.length;

			// Guard: currentQuestion should always exist
			if (!currentQuestion) return false;

			// Calculate filtered options (needed for arrow key navigation)
			const filteredOptions = currentQuestion.options.filter(
				(option) =>
					option.label.toLowerCase().includes(selectionFilter.toLowerCase()) ||
					(option.value && option.value.toLowerCase().includes(selectionFilter.toLowerCase())),
			);
			const maxIndex = filteredOptions.length - 1;

			// Arrow down - next option (works in both modes)
			if (key.downArrow) {
				setSelectedCommandIndex((prev) => (prev < maxIndex ? prev + 1 : prev));
				return true;
			}

			// Arrow up - previous option (works in both modes)
			if (key.upArrow) {
				setSelectedCommandIndex((prev) => (prev > 0 ? prev - 1 : 0));
				return true;
			}

			// Escape - exit free text mode, filter mode, or clear filter
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

			// === Free text mode ===
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

			// === Filter mode ===
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

			// === Multi-question navigation ===
			if (!isSingleQuestion) {
				if (key.tab && !key.shift) {
					setMultiSelectionPage((prev) => (prev + 1) % totalQuestions);
					setSelectedCommandIndex(0);
					setSelectionFilter("");
					setIsFilterMode(false);
					// Restore choices for the new question if it's multi-select
					const nextPage = (multiSelectionPage + 1) % totalQuestions;
					const nextQuestion = questions[nextPage];
					if (!nextQuestion) return true;
					if (nextQuestion.multiSelect) {
						// If question was already answered, restore the answer
						if (multiSelectionAnswers[nextQuestion.id]) {
							const savedAnswer = multiSelectionAnswers[nextQuestion.id];
							setMultiSelectChoices(new Set(Array.isArray(savedAnswer) ? savedAnswer : []));
						}
						// Otherwise, initialize with defaults
						else {
							// Priority 1: option.checked
							const checkedOptions = nextQuestion.options
								.filter((opt) => opt.checked)
								.map((opt) => opt.value || opt.label);

							if (checkedOptions.length > 0) {
								setMultiSelectChoices(new Set(checkedOptions));
							}
							// Priority 2: question.preSelected
							else if (nextQuestion.preSelected) {
								setMultiSelectChoices(new Set(nextQuestion.preSelected));
							} else {
								setMultiSelectChoices(new Set());
							}
						}
					} else {
						setMultiSelectChoices(new Set());
					}
					return true;
				}
				if (key.shift && key.tab) {
					setMultiSelectionPage((prev) => (prev - 1 + totalQuestions) % totalQuestions);
					setSelectedCommandIndex(0);
					setSelectionFilter("");
					setIsFilterMode(false);
					// Restore choices for the new question if it's multi-select
					const prevPage = (multiSelectionPage - 1 + totalQuestions) % totalQuestions;
					const prevQuestion = questions[prevPage];
					if (!prevQuestion) return true;
					if (prevQuestion.multiSelect) {
						// If question was already answered, restore the answer
						if (multiSelectionAnswers[prevQuestion.id]) {
							const savedAnswer = multiSelectionAnswers[prevQuestion.id];
							setMultiSelectChoices(new Set(Array.isArray(savedAnswer) ? savedAnswer : []));
						}
						// Otherwise, initialize with defaults
						else {
							// Priority 1: option.checked
							const checkedOptions = prevQuestion.options
								.filter((opt) => opt.checked)
								.map((opt) => opt.value || opt.label);

							if (checkedOptions.length > 0) {
								setMultiSelectChoices(new Set(checkedOptions));
							}
							// Priority 2: question.preSelected
							else if (prevQuestion.preSelected) {
								setMultiSelectChoices(new Set(prevQuestion.preSelected));
							} else {
								setMultiSelectChoices(new Set());
							}
						}
					} else {
						setMultiSelectChoices(new Set());
					}
					return true;
				}
			}

			// Ctrl+Enter - submit all answers (only for multi-question)
			if (!isSingleQuestion && key.ctrl && key.return) {
				// Check if all questions are answered
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

			// Space - toggle multi-select choice (only for multi-select questions and NOT in filter mode)
			if (char === " ") {
				addLog(`[multi-select] Space pressed - multiSelect: ${currentQuestion?.multiSelect}, isFilterMode: ${isFilterMode}, selectedCommandIndex: ${selectedCommandIndex}, filteredOptionsCount: ${filteredOptions.length}`);

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

			// === Enter - select option / confirm multi-select / enter free text mode ===
			if (key.return) {
				const selectedOption = filteredOptions[selectedCommandIndex];

				// Check if selected option is a free text option
				if (selectedOption?.freeText) {
					// Enter free text mode
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

					// Add user's answer to chat history
					const aiConfig = getAIConfig();
					const provider = aiConfig?.defaultProvider || "openrouter";
					const model = aiConfig?.defaultModel || "anthropic/claude-3.5-sonnet";

					const sessionIdToUse = commandSessionRef.current || currentSessionId;
					const resultSessionId = await addMessage({
						sessionId: sessionIdToUse,
						role: "user",
						content: choicesArray.join(", "),
						provider,
						model,
					});

					if (!commandSessionRef.current) {
						commandSessionRef.current = resultSessionId;
					}

					if (isSingleQuestion) {
						// Single question: submit immediately
						inputResolver.current({ [currentQuestion.id]: choicesArray });
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
							[currentQuestion.id]: choicesArray,
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
				} else {
					// Single-select mode: select one option
					const selectedOption = filteredOptions[selectedCommandIndex];
					if (selectedOption) {
						const selectedValue = selectedOption.value || selectedOption.label;
						addLog(`[selection] Q${multiSelectionPage + 1}: ${selectedValue}`);

						// Add user's answer to chat history
						const aiConfig = getAIConfig();
						const provider = aiConfig?.defaultProvider || "openrouter";
						const model = aiConfig?.defaultModel || "anthropic/claude-3.5-sonnet";

						const sessionIdToUse = commandSessionRef.current || currentSessionId;
						const resultSessionId = await addMessage({
							sessionId: sessionIdToUse,
							role: "user",
							content: selectedOption.label,
							provider,
							model,
						});

						if (!commandSessionRef.current) {
							commandSessionRef.current = resultSessionId;
						}

						if (isSingleQuestion) {
							// Single question: submit immediately
							inputResolver.current({ [currentQuestion.id]: selectedValue });
							inputResolver.current = null;
							setPendingInput(null);
							setMultiSelectionPage(0);
							setMultiSelectionAnswers({});
							setSelectionFilter("");
							setIsFilterMode(false);
						} else {
							// Multi-question: save answer
							const newAnswers = {
								...multiSelectionAnswers,
								[currentQuestion.id]: selectedValue,
							};
							setMultiSelectionAnswers(newAnswers);

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
				}
				return true;
			}

			return false; // Not our concern
		},
		{ isActive: !!pendingInput && pendingInput.type === "selection" },
	);
}
