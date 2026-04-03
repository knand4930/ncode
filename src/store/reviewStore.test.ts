import { beforeEach, describe, expect, it, vi } from "vitest";
import { useReviewStore } from "./reviewStore";

describe("reviewStore", () => {
  beforeEach(() => {
    useReviewStore.setState({
      activeDiffReview: null,
      isApplyingDiffReview: false,
    });
  });

  it("closes the review after a successful accept", async () => {
    const onAccept = vi.fn().mockResolvedValue(undefined);

    useReviewStore.getState().openDiffReview({
      title: "Review AI Update",
      sourcePath: "src/App.tsx",
      originalContent: "old",
      modifiedContent: "new",
      onAccept,
    });

    await useReviewStore.getState().acceptDiffReview();

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(useReviewStore.getState().activeDiffReview).toBeNull();
    expect(useReviewStore.getState().isApplyingDiffReview).toBe(false);
  });

  it("keeps the review open if accept fails", async () => {
    const onAccept = vi.fn().mockRejectedValue(new Error("boom"));

    useReviewStore.getState().openDiffReview({
      title: "Review AI Update",
      sourcePath: "src/App.tsx",
      originalContent: "old",
      modifiedContent: "new",
      onAccept,
    });

    await useReviewStore.getState().acceptDiffReview();

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(useReviewStore.getState().activeDiffReview?.sourcePath).toBe("src/App.tsx");
    expect(useReviewStore.getState().isApplyingDiffReview).toBe(false);
  });

  it("runs rejection handlers and closes the review", async () => {
    const onReject = vi.fn().mockResolvedValue(undefined);

    useReviewStore.getState().openDiffReview({
      title: "Review AI Update",
      sourcePath: "src/App.tsx",
      originalContent: "old",
      modifiedContent: "new",
      onReject,
    });

    await useReviewStore.getState().rejectDiffReview();

    expect(onReject).toHaveBeenCalledTimes(1);
    expect(useReviewStore.getState().activeDiffReview).toBeNull();
  });
});
