export type PostRef = {
	uri: string;
	cid: string;
};

export type CandidatePost = PostRef & {
	text: string;
	author_handle?: string;
	lang?: string;
	reply_root_uri?: string;
	indexed_at?: string;
};

export type FeedPost = PostRef & {
	accepted_at: string;
	indexed_at?: string;
	score?: number;
	text?: string;
	matched_keywords?: string[];
	judge_confidence?: number;
	judge_reason?: string;
	judge_category?: string;
};

export type RejectionReason =
	| 'reply'
	| 'excluded-account'
	| 'non-english'
	| 'duplicate'
	| 'keyword-miss'
	| 'too-short'
	| 'weak-signal'
	| 'suppressed';

export type FilterResult =
	| {
			accepted: true;
			post: CandidatePost;
			matched_keywords: string[];
	  }
	| {
			accepted: false;
			reason: RejectionReason;
			matched_keywords?: string[];
	  };
