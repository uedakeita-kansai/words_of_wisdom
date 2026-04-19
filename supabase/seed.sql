insert into public.quotes (
  display_order,
  ja_translation,
  en_translation,
  original_text,
  speaker_name,
  birth_year,
  death_year,
  source
)
values
  (
    1,
    '明日死ぬかのように生きよ。永遠に生きるかのように学べ。',
    'Live as if you were to die tomorrow. Learn as if you were to live forever.',
    'Live as if you were to die tomorrow. Learn as if you were to live forever.',
    'Mahatma Gandhi',
    1869,
    1948,
    'Attributed saying'
  ),
  (
    2,
    '最も強い者が生き残るのではなく、変化に最も適応した者が生き残る。',
    'It is not the strongest of the species that survives, nor the most intelligent, but the one most responsive to change.',
    'It is not the strongest of the species that survives, nor the most intelligent, but the one most responsive to change.',
    'Charles Darwin',
    1809,
    1882,
    'Often paraphrased from Darwinian ideas'
  ),
  (
    3,
    '成功とは最終点ではなく、失敗は致命的ではない。続ける勇気こそが重要だ。',
    'Success is not final, failure is not fatal: it is the courage to continue that counts.',
    'Success is not final, failure is not fatal: it is the courage to continue that counts.',
    'Winston Churchill',
    1874,
    1965,
    'Speech attribution (commonly cited)'
  )
on conflict (display_order) do nothing;

select public.generate_monthly_quote_schedule((timezone('Asia/Tokyo', now()))::date);
