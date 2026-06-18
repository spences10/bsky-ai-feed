export type PostRef = {
	uri: string;
	cid: string;
};

export type CandidatePost = PostRef & {
	text: string;
	lang?: string;
	reply_root_uri?: string;
	indexed_at?: string;
};

export type FeedPost = PostRef & {
	accepted_at: string;
	indexed_at?: string;
	score?: number;
};

export type RejectionReason =
	| 'reply'
	| 'non-english'
	| 'duplicate'
	| 'keyword-miss'
	| 'too-short';

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
