{% assign page_data = site.data.embedded_ai %}
{% assign papers_data = site.data.embedded_ai_papers %}
{% assign default_visible_count = 20 %}
{% assign heading_date = papers_data.generated_at | date: "%B %-d, %Y" %}

<style>
  .embedded-ai-page p {
    margin: 0 0 0.9rem 0;
  }

  .embedded-ai-links {
    margin: 0 0 1.5rem 1.2rem;
  }

  .embedded-ai-links li {
    margin-bottom: 0.45rem;
  }

  .embedded-ai-category {
    margin: 1.6rem 0 2rem;
  }

  .embedded-ai-paper-list {
    list-style: none;
    padding-left: 0;
    margin: 0;
  }

  .embedded-ai-paper-item {
    padding: 0.65rem 0;
    border-bottom: 1px solid #ececec;
  }

  .embedded-ai-paper-line {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    align-items: center;
  }

  .embedded-ai-paper-title a {
    font-weight: 600;
    text-decoration: none;
  }

  .embedded-ai-paper-title a:hover {
    text-decoration: underline;
  }

  .embedded-ai-paper-date {
    color: #777;
    font-size: 0.92rem;
    white-space: nowrap;
  }

  .embedded-ai-tag {
    display: inline-block;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 600;
    line-height: 1.4;
    vertical-align: middle;
  }

  .embedded-ai-tag--tinyml { background: #e8f0ff; color: #2457c5; }
  .embedded-ai-tag--ulp { background: #e7f8ef; color: #1f7a4d; }
  .embedded-ai-tag--lp { background: #fff4db; color: #9a6500; }
  .embedded-ai-tag--hardware { background: #f1e9ff; color: #6941c6; }
  .embedded-ai-tag--applications { background: #ffe9ef; color: #b4235c; }
  .embedded-ai-tag--default { background: #f2f4f7; color: #475467; }

  .embedded-ai-venue {
    display: inline-block;
    padding: 0.2rem 0.6rem;
    border-radius: 4px;
    font-size: 0.78rem;
    font-weight: 600;
    line-height: 1.4;
    vertical-align: middle;
    white-space: nowrap;
  }

  .embedded-ai-venue--a { background: #dcfce7; color: #166534; }
  .embedded-ai-venue--b { background: #fce7f3; color: #be185d; }
  .embedded-ai-venue--c { background: #fed7aa; color: #9a3412; }
  .embedded-ai-venue--arxiv { background: #f3f4f6; color: #6b7280; }

  .embedded-ai-paper-item.is-hidden {
    display: none;
  }

  .embedded-ai-show-more-btn {
    margin-top: 0.9rem;
    padding: 0.5rem 0.9rem;
    border: 1px solid #d0d5dd;
    border-radius: 8px;
    background: #fff;
    cursor: pointer;
    font-size: 0.95rem;
  }

  .embedded-ai-show-more-btn:hover {
    background: #f8fafc;
  }
</style>

<div class="embedded-ai-page">
  <h2>{{ page_data.title }}</h2>

  {% if page_data.intro and page_data.intro.paragraphs %}
    {% for paragraph in page_data.intro.paragraphs %}
      <p>{{ paragraph }}</p>
    {% endfor %}
  {% endif %}

  {% if page_data.useful_links and page_data.useful_links.size > 0 %}
    <h2>Useful Links</h2>
    <ul class="embedded-ai-links">
      {% for link in page_data.useful_links %}
        <li>
          <a href="{{ link.url }}" target="_blank" rel="noopener noreferrer">{{ link.title }}</a>
          {% if link.description %} — {{ link.description }}{% endif %}
        </li>
      {% endfor %}
    </ul>
  {% endif %}

{% assign heading_date = nil %}
{% if papers_data and papers_data.generated_at %}
  {% assign generated_unix = papers_data.generated_at | date: "%s" | plus: 0 %}
  {% assign heading_date = generated_unix | plus: 28800 | date: "%B %-d, %Y" %}
{% endif %}

  <h2>Papers{% if heading_date %} (Last Update: {{ heading_date }}){% endif %}</h2>

  {% if papers_data and papers_data.categories and papers_data.categories.size > 0 %}
    {% for category in papers_data.categories %}
      <section class="embedded-ai-category" id="category-{{ category.key }}">
        <h3>{{ category.title }}{% if category.count %} ({{ category.count }}){% endif %}</h3>

        {% if category.papers and category.papers.size > 0 %}
          <ul class="embedded-ai-paper-list">
            {% for paper in category.papers %}
              {% assign display_tags = paper.final_tags | default: paper.tags %}
              {% assign official_link = paper.urls.paper | default: paper.urls.ieee | default: paper.urls.acm | default: paper.urls.venue | default: paper.urls.url %}
              {% assign paper_link = paper.urls.pdf | default: official_link | default: paper.urls.arxiv %}
              
              <!-- Determine venue display: priority is matched_venue > venue > arxiv fallback -->
              {% assign display_venue = paper.matched_venue | default: "" %}
              {% assign display_venue = display_venue | strip %}
              {% assign is_arxiv_fallback = false %}
              
              {% if display_venue == "" %}
                {% if paper.filter_bucket == "arxiv" or paper.source == "arxiv" %}
                  {% assign display_venue = "arXiv" %}
                  {% assign is_arxiv_fallback = true %}
                {% endif %}
              {% endif %}
              
              <!-- Normalize venue names for display -->
              {% assign venue_text = display_venue %}
              {% if venue_text != "" and is_arxiv_fallback == false %}
                {% assign venue_lower = venue_text | downcase %}

                {% if venue_lower contains "computer-aided design of integrated circuits and systems" %}
                  {% assign venue_text = "TCAD" %}
                {% elsif venue_lower contains "pattern analysis and machine intelligence" %}
                  {% assign venue_text = "TPAMI" %}
                {% elsif venue_lower contains "neural networks and learning systems" %}
                  {% assign venue_text = "TNNLS" %}
                {% elsif venue_lower contains "circuits and systems for video technology" %}
                  {% assign venue_text = "TCSVT" %}
                {% elsif venue_lower contains "computer vision and pattern recognition" or venue_lower contains "cvpr" %}
                  {% assign venue_text = "CVPR" %}
                {% elsif venue_lower contains "international conference on computer vision" or venue_lower contains "iccv" %}
                  {% assign venue_text = "ICCV" %}
                {% elsif venue_lower contains "european conference on computer vision" or venue_lower contains "eccv" %}
                  {% assign venue_text = "ECCV" %}
                {% elsif venue_lower contains "neural information processing systems" or venue_lower contains "neurips" %}
                  {% assign venue_text = "NeurIPS" %}
                {% elsif venue_lower contains "machine learning" and venue_lower contains "conference" or venue_lower contains "icml" %}
                  {% assign venue_text = "ICML" %}
                {% elsif venue_lower contains "learning representations" or venue_lower contains "iclr" %}
                  {% assign venue_text = "ICLR" %}
                {% elsif venue_lower contains "artificial intelligence" and venue_lower contains "aaai" or venue_lower contains "aaai" %}
                  {% assign venue_text = "AAAI" %}
                {% elsif venue_lower contains "international joint conference on artificial intelligence" or venue_lower contains "ijcai" %}
                  {% assign venue_text = "IJCAI" %}
                {% elsif venue_lower contains "association for computational linguistics" or venue_lower contains "acl" %}
                  {% assign venue_text = "ACL" %}
                {% elsif venue_lower contains "empirical methods in natural language processing" or venue_lower contains "emnlp" %}
                  {% assign venue_text = "EMNLP" %}
                {% elsif venue_lower contains "design automation conference" or venue_lower contains "dac" %}
                  {% assign venue_text = "DAC" %}
                {% elsif venue_lower contains "design, automation and test in europe" or venue_lower contains "design automation and test in europe" or venue_lower contains "date" %}
                  {% assign venue_text = "DATE" %}
                {% elsif venue_lower contains "international conference on computer-aided design" or venue_lower contains "iccad" %}
                  {% assign venue_text = "ICCAD" %}
                {% elsif venue_lower contains "architectural support for programming languages and operating systems" or venue_lower contains "asplos" %}
                  {% assign venue_text = "ASPLOS" %}
                {% elsif venue_lower contains "computer architecture" and venue_lower contains "symposium" or venue_lower contains "isca" %}
                  {% assign venue_text = "ISCA" %}
                {% elsif venue_lower contains "microarchitecture" or venue_lower contains "micro" %}
                  {% assign venue_text = "MICRO" %}
                {% endif %}

                {% assign venue_text = venue_text | replace: "IEEE/CVF ", "" | replace: "IEEE/CVF", "" | replace: "IEEE ", "" | replace: "ACM ", "" | replace: "Springer ", "" | replace: "Elsevier ", "" | replace: "Proceedings of the ", "" | replace: "Proceedings of ", "" | replace: "Transactions on ", "" | replace: "International Conference on ", "" | replace: "Conference on ", "" | replace: "Workshop on ", "" | replace: "Symposium on ", "" | strip %}
              {% endif %}

              <!-- Determine color class based on TH-CPL level or arxiv fallback -->
              {% assign venue_class = "embedded-ai-venue--arxiv" %}
              {% if is_arxiv_fallback == false %}
                {% if paper.matched_th_cpl_level == "A" %}
                  {% assign venue_class = "embedded-ai-venue--a" %}
                {% elsif paper.matched_th_cpl_level == "B" %}
                  {% assign venue_class = "embedded-ai-venue--b" %}
                {% elsif paper.matched_th_cpl_level == "C" %}
                  {% assign venue_class = "embedded-ai-venue--c" %}
                {% endif %}
              {% else %}
                {% assign venue_class = "embedded-ai-venue--arxiv" %}
              {% endif %}
              {% assign date_text = "" %}

              {% if paper.year and paper.month %}
                {% assign month_num = paper.month | plus: 0 %}
                {% if month_num < 10 %}
                  {% assign date_text = paper.year | append: "-0" | append: month_num %}
                {% else %}
                  {% assign date_text = paper.year | append: "-" | append: month_num %}
                {% endif %}
              {% elsif paper.arxiv_id %}
                {% assign arxiv_base = paper.arxiv_id | split: "." | first %}
                {% assign arxiv_yy = arxiv_base | slice: 0, 2 %}
                {% assign arxiv_mm = arxiv_base | slice: 2, 2 %}
                {% if arxiv_yy != "" and arxiv_mm != "" %}
                  {% assign date_text = "20" | append: arxiv_yy | append: "-" | append: arxiv_mm %}
                {% endif %}
              {% elsif paper.year %}
                {% assign date_text = paper.year %}
              {% endif %}

              <li class="embedded-ai-paper-item{% if forloop.index > default_visible_count %} is-hidden{% endif %}">
                <div class="embedded-ai-paper-line">
                  {% if display_tags and display_tags.size > 0 %}
                    {% assign first_tag = display_tags[0] | downcase %}
                    {% assign badge_class = "embedded-ai-tag--default" %}
                    {% if first_tag contains "tinyml" %}
                      {% assign badge_class = "embedded-ai-tag--tinyml" %}
                    {% elsif first_tag contains "ulp" or first_tag contains "ultra-low-power" %}
                      {% assign badge_class = "embedded-ai-tag--ulp" %}
                    {% elsif first_tag == "lp" or first_tag contains "low-power" %}
                      {% assign badge_class = "embedded-ai-tag--lp" %}
                    {% elsif first_tag contains "accelerator" or first_tag contains "hardware" or first_tag contains "architecture" %}
                      {% assign badge_class = "embedded-ai-tag--hardware" %}
                    {% elsif first_tag contains "application" %}
                      {% assign badge_class = "embedded-ai-tag--applications" %}
                    {% endif %}
                    <span class="embedded-ai-tag {{ badge_class }}">{{ display_tags[0] }}</span>
                  {% endif %}

                  <span class="embedded-ai-paper-title">
                    {% if paper_link and paper_link != "" %}
                      <a href="{{ paper_link }}" target="_blank" rel="noopener noreferrer">{{ paper.title }}</a>
                    {% else %}
                      {{ paper.title }}
                    {% endif %}
                  </span>

                  {% if venue_text and venue_text != "" %}
                    <span class="embedded-ai-venue {{ venue_class }}">{{ venue_text }}</span>
                  {% endif %}

                  {% if date_text != "" %}
                    <span class="embedded-ai-paper-date">{{ date_text }}</span>
                  {% endif %}
                </div>
              </li>
            {% endfor %}
          </ul>

          {% if category.papers.size > default_visible_count %}
            <button type="button" class="embedded-ai-show-more-btn">
              Show more
            </button>
          {% endif %}
        {% else %}
          <p>No papers have been added to this category yet.</p>
        {% endif %}
      </section>
    {% endfor %}
  {% else %}
    <p>No paper data is available yet.</p>
  {% endif %}
</div>

<script src="{{ '/assets/js/embedded-ai.js' | relative_url }}"></script>