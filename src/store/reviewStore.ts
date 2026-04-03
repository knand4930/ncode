import { create } from "zustand";

export interface DiffReview {
  id: string;
  title: string;
  sourcePath: string;
  originalContent: string;
  modifiedContent: string;
  description?: string;
  note?: string;
  acceptLabel?: string;
  rejectLabel?: string;
  onAccept?: () => Promise<void> | void;
  onReject?: () => Promise<void> | void;
}

interface ReviewStore {
  activeDiffReview: DiffReview | null;
  isApplyingDiffReview: boolean;
  openDiffReview: (review: Omit<DiffReview, "id"> & { id?: string }) => void;
  closeDiffReview: () => void;
  acceptDiffReview: () => Promise<void>;
  rejectDiffReview: () => Promise<void>;
}

export const useReviewStore = create<ReviewStore>((set, get) => ({
  activeDiffReview: null,
  isApplyingDiffReview: false,

  openDiffReview: (review) =>
    set({
      activeDiffReview: {
        ...review,
        id: review.id ?? `review-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      },
      isApplyingDiffReview: false,
    }),

  closeDiffReview: () => {
    if (get().isApplyingDiffReview) return;
    set({ activeDiffReview: null });
  },

  acceptDiffReview: async () => {
    const review = get().activeDiffReview;
    if (!review || !review.onAccept || get().isApplyingDiffReview) return;

    set({ isApplyingDiffReview: true });
    try {
      await review.onAccept();
      set({ activeDiffReview: null });
    } catch (error) {
      console.error("Failed to accept diff review:", error);
    } finally {
      set({ isApplyingDiffReview: false });
    }
  },

  rejectDiffReview: async () => {
    const review = get().activeDiffReview;
    if (!review || get().isApplyingDiffReview) return;

    try {
      await review.onReject?.();
    } catch (error) {
      console.error("Failed to reject diff review:", error);
    } finally {
      set({ activeDiffReview: null });
    }
  },
}));
