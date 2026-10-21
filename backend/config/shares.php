<?php

return [
    // How long a newly-created share link lives for when the caller doesn't
    // request a shorter one, and the hard ceiling even if they ask for
    // longer - see Section 15 of CLAUDE_IMPLEMENTATION_BRIEF_RESEARCH_SAAS.md.
    'default_days' => env('SHARE_LINK_DEFAULT_DAYS', 7),
    'max_days' => env('SHARE_LINK_MAX_DAYS', 90),
];
